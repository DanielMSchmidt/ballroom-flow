// US-010 — History-based per-user undo (PLAN §5.4, D14, Q-UNDO).
//
// Automerge has NO turnkey per-user UndoManager (unlike Yjs). Undo is built from
// history: find the user's OWN last change (filter the change log by actor id),
// compute its inverse, and apply that inverse as a NEW change. Because it's a
// normal change, it MERGES with others' concurrent edits — so A's undo reverts
// only A's change and B's concurrent edit survives (§5.4). There is no op-log and
// no external undo stack: the undo/redo state machine lives entirely in change
// MESSAGES (`ballroom:undo:<hash>` / `ballroom:redo:<hash>`), so it survives
// reloads and merges like everything else.
//
// Scope is the single document passed in (Q-UNDO: no cross-document undo).
// `actorId` is the Automerge actor id of the user; the app-user → actor-id
// mapping is the store seam's concern, not this pure helper.
//
// SOUNDNESS (PLAN §5.4, LOCKED 2026-07-02 — the two review-verified failure
// modes this file must never reintroduce):
//  1. The inverse must target list elements BY IDENTITY, never by positional
//     index. `A.diff` patches carry HISTORICAL indices; replaying them against
//     the CURRENT doc deletes a concurrent peer's element (e.g. A and B both
//     insert at index 0 → A's undo, replayed positionally, removes B's item).
//     We therefore simulate the inverse against the exact historical state the
//     indices refer to, record IDENTITY-anchored operations (element ids), and
//     apply those to the live doc — an element that moved survives; an element
//     that's gone makes the op a no-op.
//  2. An already-undone change is NEVER re-selected. Each undo records WHICH
//     change it reverted (the hash in its message); target selection skips
//     reverted changes, so a second undo press walks back to the user's
//     previous change — and is a no-op when nothing undoable remains — instead
//     of destructively re-inverting the same change.
import * as A from "@automerge/automerge";

/** Message tag of an undo change; the reverted change's hash follows a colon. */
const UNDO_TAG = "ballroom:undo";
/** Message tag of a redo change; the inverted UNDO change's hash follows a colon. */
const REDO_TAG = "ballroom:redo";

const isUndoMessage = (m: string | null): boolean =>
  m === UNDO_TAG || (m?.startsWith(`${UNDO_TAG}:`) ?? false);
const isRedoMessage = (m: string | null): boolean =>
  m === REDO_TAG || (m?.startsWith(`${REDO_TAG}:`) ?? false);
/** The hash suffix of a tagged message; undefined for the legacy bare tags. */
const taggedHash = (m: string, tag: string): string | undefined =>
  m.length > tag.length + 1 ? m.slice(tag.length + 1) : undefined;

/** Decoded change with the fields we need to locate + invert it. */
interface ChangeMeta {
  actor: string;
  seq: number;
  hash: string;
  deps: string[];
  /** The change's commit message, if any (the undo/redo state machine). */
  message: string | null;
}

/** The actor's own changes, oldest→newest (by seq). */
function changesByActor<T>(doc: A.Doc<T>, actorId: string): ChangeMeta[] {
  return A.getAllChanges(doc)
    .map((c) => A.decodeChange(c))
    .filter((c) => c.actor === actorId && c.hash != null)
    .map((c) => ({
      actor: c.actor,
      seq: c.seq,
      hash: c.hash,
      deps: c.deps,
      message: c.message,
    }))
    .sort((a, b) => a.seq - b.seq);
}

/**
 * The set of the actor's change hashes that are currently REVERTED — i.e. an
 * undo reverted them and no later redo restored them. Replays the actor's
 * undo/redo messages oldest→newest. Legacy bare-tag messages (pre-hash) are
 * resolved the way the old selection logic would have: an undo reverts the
 * latest not-yet-reverted plain change before it; a redo restores the latest
 * still-reverted target.
 */
function revertedSet(mine: ChangeMeta[]): Set<string> {
  const reverted = new Set<string>();
  const undoTargets = new Map<string, string>(); // undo change hash → reverted hash
  const plainBefore: string[] = []; // plain (non-undo/redo) hashes, oldest→newest
  for (const c of mine) {
    if (isUndoMessage(c.message)) {
      let target = c.message ? taggedHash(c.message, UNDO_TAG) : undefined;
      if (target === undefined) {
        target = [...plainBefore].reverse().find((h) => !reverted.has(h));
      }
      if (target !== undefined) {
        reverted.add(target);
        undoTargets.set(c.hash, target);
      }
    } else if (isRedoMessage(c.message)) {
      const undoHash = c.message ? taggedHash(c.message, REDO_TAG) : undefined;
      let target = undoHash !== undefined ? undoTargets.get(undoHash) : undefined;
      if (target === undefined) {
        // Legacy redo: restore the most recently reverted target.
        target = [...plainBefore].reverse().find((h) => reverted.has(h));
      }
      if (target !== undefined) reverted.delete(target);
    } else {
      plainBefore.push(c.hash);
    }
  }
  return reverted;
}

// ---------------------------------------------------------------------------
// Identity-anchored inverse application (soundness rule 1).
//
// `A.diff(doc, [target.hash], target.deps)` yields the patches that turn the
// state AFTER the target change into the state BEFORE it — with list indices
// valid in that historical state only. We replay them against a plain-JS copy
// of the historical after-state (where they are exact), and while doing so
// record what they MEAN in identity terms (remove the element with id X;
// insert Y after the element with id Z; set field F of the object with id X).
// Those identity ops are then applied to the live doc inside one A.change.
// ---------------------------------------------------------------------------

/** How a list element is identified in the live doc: by its `id` field when it
 *  has one (every entity in our doc shapes does), else by deep value. */
type ElemKey = { id: string } | { json: string };

/** One step of an identity path: a map key, or a list position + element key. */
type Seg = string | { at: number; elem: ElemKey | null };

type IdentityOp =
  | { kind: "insert"; path: Seg[]; after: ElemKey | null; at: number; values: unknown[] }
  | { kind: "remove"; path: Seg[]; elem: ElemKey; at: number }
  | { kind: "set"; path: Seg[]; key: string }
  | { kind: "inc"; path: Seg[]; key: string; by: number };

function elemKeyOf(value: unknown): ElemKey {
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string"
  ) {
    return { id: (value as { id: string }).id };
  }
  return { json: JSON.stringify(value) };
}

function matchesKey(value: unknown, key: ElemKey): boolean {
  if ("id" in key) {
    return value !== null && typeof value === "object" && (value as { id?: unknown }).id === key.id;
  }
  return JSON.stringify(value) === key.json;
}

/** Walk a raw (numeric-index) path against the simulation state. */
function nodeAt(root: unknown, path: A.Prop[]): unknown {
  let node = root;
  for (const prop of path) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[prop];
  }
  return node;
}

/** Convert a raw container path into an identity path, reading element
 *  identities from the CURRENT simulation state (where indices are exact). */
function identityPath(sim: unknown, path: A.Prop[]): Seg[] {
  const segs: Seg[] = [];
  let node = sim;
  for (const prop of path) {
    if (Array.isArray(node) && typeof prop === "number") {
      segs.push({ at: prop, elem: prop < node.length ? elemKeyOf(node[prop]) : null });
    } else {
      segs.push(String(prop));
    }
    if (node == null || typeof node !== "object") return segs;
    node = (node as Record<string | number, unknown>)[prop];
  }
  return segs;
}

/**
 * Resolve an identity path. Against the LIVE draft (`strict`), list steps
 * resolve by element identity ONLY — a missing element makes the op a no-op
 * (positional fallback against a merged doc is exactly the corruption this
 * module exists to prevent). Against the historical simulation (non-strict),
 * the positional hint is a safe fallback because those indices are exact.
 */
function resolveIdentity(root: unknown, path: Seg[], strict: boolean): unknown {
  let node = root;
  for (const seg of path) {
    if (node == null || typeof node !== "object") return undefined;
    if (typeof seg === "string") {
      node = (node as Record<string, unknown>)[seg];
      continue;
    }
    if (!Array.isArray(node)) return undefined;
    const list = node as unknown[];
    let idx = seg.elem ? list.findIndex((e) => matchesKey(e, seg.elem as ElemKey)) : -1;
    if (idx < 0 && !strict) idx = seg.at < list.length ? seg.at : -1; // exact historical position
    if (idx < 0) return undefined;
    node = list[idx];
  }
  return node;
}

const canonical = (path: Seg[], key: string): string =>
  `${path.map((s) => (typeof s === "string" ? `.${s}` : `[${"id" in (s.elem ?? {}) ? (s.elem as { id: string }).id : `#${s.at}`}]`)).join("")}::${key}`;

/**
 * Simulate the inverse patches against the historical after-state and record
 * identity-anchored operations. `sim` is mutated in place; `values` captured by
 * insert ops reference into `sim`, so they pick up nested fills from later
 * patches and are cloned only at application time.
 */
function recordIdentityOps(
  sim: unknown,
  patches: A.Patch[],
): { ops: IdentityOp[]; sets: Map<string, { path: Seg[]; key: string }> } {
  const ops: IdentityOp[] = [];
  const sets = new Map<string, { path: Seg[]; key: string }>();
  const recordSet = (path: Seg[], key: string): void => {
    sets.set(canonical(path, key), { path, key });
  };

  for (const patch of patches) {
    const rawKey = patch.path.at(-1);
    if (rawKey === undefined) continue;
    const containerPath = patch.path.slice(0, -1);
    const container = nodeAt(sim, containerPath);

    // Text-sequence edits: the "container" is the string itself; the real
    // assignment happens on its parent object's field.
    const isTextEdit = typeof container === "string" && typeof rawKey === "number";
    if (isTextEdit) {
      const field = patch.path.at(-2);
      const parentPath = patch.path.slice(0, -2);
      const parent = nodeAt(sim, parentPath);
      if (parent == null || typeof parent !== "object" || field === undefined) continue;
      const obj = parent as Record<string | number, unknown>;
      const cur = typeof obj[field] === "string" ? (obj[field] as string) : "";
      if (patch.action === "splice" && typeof patch.value === "string") {
        obj[field] = cur.slice(0, rawKey) + patch.value + cur.slice(rawKey);
      } else if (patch.action === "del") {
        const len = patch.length ?? 1;
        obj[field] = cur.slice(0, rawKey) + cur.slice(rawKey + len);
      } else {
        continue;
      }
      recordSet(identityPath(sim, parentPath), String(field));
      continue;
    }

    if (container === undefined || container === null || typeof container !== "object") continue;

    switch (patch.action) {
      case "put": {
        const idPath = identityPath(sim, containerPath);
        (container as Record<string | number, unknown>)[rawKey] = patch.value;
        recordSet(idPath, String(rawKey));
        break;
      }
      case "del": {
        if (Array.isArray(container) && typeof rawKey === "number") {
          const len = patch.length ?? 1;
          const idPath = identityPath(sim, containerPath);
          for (let i = 0; i < len && rawKey < container.length; i += 1) {
            const [removed] = container.splice(rawKey, 1);
            ops.push({ kind: "remove", path: idPath, elem: elemKeyOf(removed), at: rawKey + i });
          }
        } else {
          const idPath = identityPath(sim, containerPath);
          delete (container as Record<string | number, unknown>)[rawKey];
          recordSet(idPath, String(rawKey));
        }
        break;
      }
      case "insert": {
        if (!Array.isArray(container) || typeof rawKey !== "number") break;
        const idPath = identityPath(sim, containerPath);
        const after =
          rawKey > 0 && rawKey - 1 < container.length ? elemKeyOf(container[rawKey - 1]) : null;
        const inserted = patch.values.map((v) =>
          v !== null && typeof v === "object" ? structuredClone(v) : v,
        );
        container.splice(rawKey, 0, ...inserted);
        // Reference the in-sim elements so later nested patches (fills of a
        // composite element) are captured; cloned at application time.
        ops.push({
          kind: "insert",
          path: idPath,
          after,
          at: rawKey,
          values: container.slice(rawKey, rawKey + inserted.length),
        });
        break;
      }
      case "inc": {
        const idPath = identityPath(sim, containerPath);
        const rec = container as Record<string | number, number>;
        rec[rawKey] = (rec[rawKey] ?? 0) + patch.value;
        ops.push({ kind: "inc", path: idPath, key: String(rawKey), by: patch.value });
        break;
      }
      case "splice": {
        // Non-text splice (shouldn't occur for our shapes) — ignore.
        break;
      }
      default:
        // conflict/mark/unmark and other patch kinds: no-op for v1 shapes.
        break;
    }
  }
  return { ops, sets };
}

/** Apply the recorded identity ops to the live draft. Missing targets are
 *  skipped (a concurrent edit removed them) — undo is best-effort per element,
 *  never positional. */
function applyIdentityOps(
  draft: unknown,
  sim: unknown,
  ops: IdentityOp[],
  sets: Map<string, { path: Seg[]; key: string }>,
): void {
  // Structural list ops first (inserts before removes doesn't matter — they
  // target disjoint elements), then field sets shallow→deep, then counters.
  for (const op of ops) {
    if (op.kind !== "insert") continue;
    const list = resolveIdentity(draft, op.path, true);
    if (!Array.isArray(list)) continue;
    let at = 0;
    if (op.after) {
      const prev = list.findIndex((e) => matchesKey(e, op.after as ElemKey));
      at = prev >= 0 ? prev + 1 : Math.min(op.at, list.length);
    }
    // Skip elements that already exist (idempotent under duplicate replay).
    const values = op.values
      .filter((v) => !list.some((e) => matchesKey(e, elemKeyOf(v))))
      .map((v) => (v !== null && typeof v === "object" ? structuredClone(v) : v));
    if (values.length > 0) list.splice(at, 0, ...values);
  }
  for (const op of ops) {
    if (op.kind !== "remove") continue;
    const list = resolveIdentity(draft, op.path, true);
    if (!Array.isArray(list)) continue;
    const idx = list.findIndex((e) => matchesKey(e, op.elem));
    if (idx >= 0) list.splice(idx, 1);
  }
  const orderedSets = [...sets.values()].sort((a, b) => a.path.length - b.path.length);
  for (const { path, key } of orderedSets) {
    const target = resolveIdentity(draft, path, true);
    if (target == null || typeof target !== "object" || Array.isArray(target)) continue;
    const simContainer = resolveIdentity(sim, path, false);
    if (simContainer == null || typeof simContainer !== "object") continue;
    const finalValue = (simContainer as Record<string, unknown>)[key];
    if (finalValue === undefined) {
      delete (target as Record<string, unknown>)[key];
    } else {
      (target as Record<string, unknown>)[key] =
        finalValue !== null && typeof finalValue === "object"
          ? structuredClone(finalValue)
          : finalValue;
    }
  }
  for (const op of ops) {
    if (op.kind !== "inc") continue;
    const target = resolveIdentity(draft, op.path, true);
    if (target == null || typeof target !== "object") continue;
    const rec = target as Record<string, number>;
    rec[op.key] = (rec[op.key] ?? 0) + op.by;
  }
}

/** Invert one change and apply it as a new change tagged with `message`. */
function invertChange<T>(doc: A.Doc<T>, target: ChangeMeta, message: string): A.Doc<T> {
  // AFTER→BEFORE diff = the patches that revert this change (historical coords).
  const inverse = A.diff(doc, [target.hash], target.deps);
  // The historical state those coordinates are exact in.
  const sim: unknown = A.toJS(A.view(doc, [target.hash]));
  const { ops, sets } = recordIdentityOps(sim, inverse);
  return A.change(doc, { message }, (draft) => {
    applyIdentityOps(draft, sim, ops, sets);
  });
}

/**
 * Undo: revert `actorId`'s most recent not-yet-reverted *editing* change,
 * applied as a new (mergeable) change tagged `ballroom:undo:<hash>`. Reverts
 * only that user's change; others' concurrent edits are preserved (identity
 * anchoring — soundness rule 1). Successive presses walk back through the
 * user's own changes, each reverted AT MOST ONCE (soundness rule 2); a press
 * with nothing left to undo is a no-op.
 *
 * CONCURRENCY / SUPERSEDE (§5.4/Q-UNDO, tracked #73): the inverse restores a
 * FIELD's pre-change value, so undoing a write to a cell ANOTHER actor
 * concurrently also wrote will SUPERSEDE that concurrent value (A and B both
 * set `x`; A's undo restores the old `x`, dropping B's). A disjoint concurrent
 * edit (different cell, or a different list element) is untouched and survives.
 * This is the accepted Q-UNDO "superseded" case — the CRDT merges, there is no
 * hard refusal; US-038's UI shows a soft "superseded" hint precisely here.
 */
export function undoLastChange<T>(doc: A.Doc<T>, actorId: string): A.Doc<T> {
  const target = undoTarget(doc, actorId);
  if (!target) return doc;
  return invertChange(doc, target, `${UNDO_TAG}:${target.hash}`);
}

/** The change a call to `undoLastChange(doc, actorId)` would revert: the
 *  actor's newest editing change that no effective undo has already reverted.
 *  undefined when there's nothing to undo — shared by `undoLastChange` and
 *  `wasSupersededByOthers` so the hint and the action always agree. */
function undoTarget<T>(doc: A.Doc<T>, actorId: string): ChangeMeta | undefined {
  const mine = changesByActor(doc, actorId);
  const reverted = revertedSet(mine);
  return [...mine]
    .reverse()
    .find((c) => !isUndoMessage(c.message) && !isRedoMessage(c.message) && !reverted.has(c.hash));
}

/**
 * US-038 AC-3 — the soft "superseded by others" hint (advisory, PLAN §5.4).
 *
 * Reports whether ANOTHER actor has BUILT ON the change `undoLastChange(doc,
 * actorId)` would revert — i.e. some change by a different actor causally
 * DEPENDS ON (is a transitive successor of) the undo target in the Automerge
 * change graph. This is a pure read of history; it NEVER blocks undo — undo
 * always proceeds (the CRDT merges). The UI uses it only to soften the "Undone"
 * toast to "Undone — others had built on this change".
 *
 * PRECISION: this is the EXACT causal "built on" relation, not a heuristic — it
 * walks the real dependency DAG (`deps`/`hash`), so it is true iff a different
 * actor's change has the target in its causal history. False positives are
 * therefore essentially nil for the "built on" meaning.
 *
 * SCOPE / KNOWN LIMITS (deliberate, documented):
 *  • A purely CONCURRENT edit by another actor (one that never saw the target,
 *    so does NOT depend on it) is NOT flagged — it didn't "build on" the change.
 *    The separate Q-UNDO same-cell LWW clobber (undo restoring a cell another
 *    actor concurrently overwrote, see `undoLastChange` doc) is a DISTINCT
 *    phenomenon and is intentionally out of this hint's scope.
 *  • Only the next undo target is inspected, not the full history walk-back.
 * Returns false when there is nothing to undo.
 */
export function wasSupersededByOthers<T>(doc: A.Doc<T>, actorId: string): boolean {
  const target = undoTarget(doc, actorId);
  if (!target) return false;

  // Build successor edges (dep → dependant) across the whole change graph, then
  // walk forward from the target: any reachable change authored by a DIFFERENT
  // actor causally built on the target.
  const all = A.getAllChanges(doc).map((c) => A.decodeChange(c));
  const successors = new Map<string, { actor: string; hash: string }[]>();
  for (const c of all) {
    if (c.hash == null) continue;
    const node = { actor: c.actor, hash: c.hash };
    for (const dep of c.deps) {
      const list = successors.get(dep);
      if (list) list.push(node);
      else successors.set(dep, [node]);
    }
  }

  const seen = new Set<string>();
  const queue = [target.hash];
  while (queue.length > 0) {
    const hash = queue.pop() as string;
    for (const succ of successors.get(hash) ?? []) {
      if (seen.has(succ.hash)) continue;
      seen.add(succ.hash);
      if (succ.actor !== actorId) return true; // another actor built on the target
      queue.push(succ.hash);
    }
  }
  return false;
}

/**
 * Redo: re-apply the change the user just undid — ONLY if an undo is actually
 * pending, i.e. the actor's last change is an undo (nothing edited since). In
 * that case we invert the undo (tagged `ballroom:redo:<undoHash>`, which also
 * un-marks the reverted target in the ledger), restoring the original effect.
 *
 * If the actor's last change is a normal edit (they moved on after undoing),
 * redo is a NO-OP — a new edit clears the redo (US-010 AC-3). Crucially this
 * means redo must NOT blindly invert the last change, or it would delete that
 * fresh edit. There is no external stack: the tags in the change history are
 * the redo state. (1-deep toggle: undo↔redo, not a multi-level cursor.)
 */
export function redoLastChange<T>(doc: A.Doc<T>, actorId: string): A.Doc<T> {
  const mine = changesByActor(doc, actorId);
  const last = mine[mine.length - 1];
  if (!last || !isUndoMessage(last.message)) return doc; // no pending undo → no-op
  return invertChange(doc, last, `${REDO_TAG}:${last.hash}`);
}
