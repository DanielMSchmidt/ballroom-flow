// US-010 — History-based per-user undo (PLAN §5.4, D14, Q-UNDO).
//
// Automerge has NO turnkey per-user UndoManager (unlike Yjs). Undo is built from
// history: find the user's OWN last change (filter the change log by actor id),
// compute its inverse, and apply that inverse as a NEW change. Because it's a
// normal change, it MERGES with others' concurrent edits — so A's undo reverts
// only A's change and B's concurrent edit survives (§5.4). There is no op-log and
// no external undo stack: redo is simply "invert the last change again" (the last
// change being the undo), which re-applies the original effect.
//
// Scope is the single document passed in (Q-UNDO: no cross-document undo of a
// copy-on-write). `actorId` is the Automerge actor id of the user; the app-user →
// actor-id mapping is the store seam's concern (M2), not this pure helper.
//
// The inverse is computed with `A.diff(doc, afterHeads, beforeHeads)` — diffing
// in the AFTER→BEFORE direction yields exactly the patches that revert the target
// change — then those patches are replayed inside a single `A.change`.
import * as A from "@automerge/automerge";

/** Change message tag marking an inverse change as an undo (vs a normal edit). */
const UNDO_MESSAGE = "ballroom:undo";

/** Decoded change with the fields we need to locate + invert it. */
interface ChangeMeta {
  actor: string;
  seq: number;
  hash: string;
  deps: string[];
  /** The change's commit message, if any (used to tag undos — see UNDO_MESSAGE). */
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
      hash: c.hash as string,
      deps: c.deps,
      message: c.message,
    }))
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Apply the patches that invert one change (computed AFTER→BEFORE) as a new
 * change on `doc`. Handles the map/list operations our document graph uses;
 * unknown patch actions are ignored (no-op) rather than throwing, so a partial
 * shape can't break an undo.
 */
function applyInverse<T>(doc: A.Doc<T>, patches: A.Patch[], message: string): A.Doc<T> {
  return A.change(doc, { message }, (draft) => {
    for (const patch of patches) {
      const target = resolveContainer(draft as unknown, patch.path);
      if (target === undefined) continue;
      const key = patch.path.at(-1);
      if (key === undefined) continue; // root-level patch — nothing to key into
      switch (patch.action) {
        case "put":
          (target as Record<string | number, unknown>)[key] = patch.value;
          break;
        case "del":
          if (Array.isArray(target) && typeof key === "number") {
            target.splice(key, (patch as { length?: number }).length ?? 1);
          } else {
            delete (target as Record<string | number, unknown>)[key];
          }
          break;
        case "insert":
          if (Array.isArray(target) && typeof key === "number") {
            target.splice(key, 0, ...patch.values);
          }
          break;
        case "splice": {
          // Automerge 3 stores string fields as text sequences, so reverting a
          // whole-string field change (e.g. a section rename) emits put("") +
          // splice(insert the before-value) — NOT a single `put`. Replaying only
          // the `put` would leave the field empty (the original undo bug). Apply
          // the text splice by reconstructing the string on its PARENT object.
          // (v1 assigns string fields wholesale; this also handles partial splices.)
          if (typeof key === "number" && typeof patch.value === "string") {
            const field = patch.path.at(-2);
            let parent: unknown = draft;
            for (const prop of patch.path.slice(0, -2)) {
              if (parent == null || typeof parent !== "object") break;
              parent = (parent as Record<string | number, unknown>)[prop];
            }
            if (parent != null && typeof parent === "object" && field !== undefined) {
              const obj = parent as Record<string | number, unknown>;
              const cur = typeof obj[field] === "string" ? (obj[field] as string) : "";
              obj[field] = cur.slice(0, key) + patch.value + cur.slice(key);
            }
          }
          break;
        }
        case "inc": {
          const counter = target as Record<string | number, number>;
          counter[key] = (counter[key] ?? 0) + patch.value;
          break;
        }
        default:
          // conflict/mark/unmark and other patch kinds: no-op for v1 shapes.
          break;
      }
    }
  });
}

/** Walk `path` (minus its last prop) to the container the patch mutates. */
function resolveContainer(root: unknown, path: A.Prop[]): unknown {
  let node = root;
  // Walk every prop except the last (the patch keys into the container we return).
  for (const prop of path.slice(0, -1)) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[prop];
  }
  return node;
}

/** Invert one change and apply it as a new change tagged with `message`. */
function invertChange<T>(doc: A.Doc<T>, target: ChangeMeta, message: string): A.Doc<T> {
  // AFTER→BEFORE diff = the patches that revert this change.
  const inverse = A.diff(doc, [target.hash], target.deps);
  return applyInverse(doc, inverse, message);
}

/**
 * Undo: revert `actorId`'s last *editing* change, applied as a new (mergeable)
 * change tagged as an undo. Reverts only that user's change; others' concurrent
 * edits are preserved (the inverse is a normal change that merges).
 *
 * Single-level (PLAN §5.4/Q-UNDO — "undo my last change"): the target is the
 * last change by the actor that is NOT itself an undo, so a pending undo isn't
 * undone again (that would be the multi-level walk-back v1 doesn't do). No-op if
 * the actor has no such change.
 *
 * CONCURRENCY / SUPERSEDE (§5.4/Q-UNDO, tracked #73): the inverse replays the
 * cell's pre-change state, so undoing a write to a cell ANOTHER actor concurrently
 * also wrote will RESTORE the pre-change state and thereby SUPERSEDE that
 * concurrent value (e.g. A and B both set `x`; A's undo clears `x`, dropping B's
 * value). A disjoint concurrent edit (different cell) is untouched and survives.
 * This is the accepted Q-UNDO "superseded" case — the CRDT merges, there is no
 * hard refusal; US-038's UI shows a soft "superseded" hint precisely here.
 */
export function undoLastChange<T>(doc: A.Doc<T>, actorId: string): A.Doc<T> {
  const target = undoTarget(doc, actorId);
  if (!target) return doc;
  return invertChange(doc, target, UNDO_MESSAGE);
}

/** The change a call to `undoLastChange(doc, actorId)` would revert: the actor's
 *  last *editing* change (not itself an undo). undefined when there's nothing to
 *  undo — shared by `undoLastChange` and `wasSupersededByOthers` so the hint and
 *  the action always agree on the target. */
function undoTarget<T>(doc: A.Doc<T>, actorId: string): ChangeMeta | undefined {
  const mine = changesByActor(doc, actorId);
  return [...mine].reverse().find((c) => c.message !== UNDO_MESSAGE);
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
 *  • Single-level, like undo: only the next undo target is inspected, not the
 *    full history walk-back.
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
 * that case we invert the undo, restoring the original effect.
 *
 * If the actor's last change is a normal edit (they moved on after undoing),
 * redo is a NO-OP — a new edit clears the redo (US-010 AC-3). Crucially this
 * means redo must NOT blindly invert the last change, or it would delete that
 * fresh edit. There is no external stack: the undo tag in the change history is
 * the redo state. (1-deep toggle: undo↔redo, not a multi-level cursor.)
 */
export function redoLastChange<T>(doc: A.Doc<T>, actorId: string): A.Doc<T> {
  const mine = changesByActor(doc, actorId);
  const last = mine[mine.length - 1];
  if (!last || last.message !== UNDO_MESSAGE) return doc; // no pending undo → no-op
  return invertChange(doc, last, "ballroom:redo");
}
