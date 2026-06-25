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

/** Decoded change with the fields we need to locate + invert it. */
interface ChangeMeta {
  actor: string;
  seq: number;
  hash: string;
  deps: string[];
}

/** The actor's own changes, oldest→newest (by seq). */
function changesByActor<T>(doc: A.Doc<T>, actorId: string): ChangeMeta[] {
  return A.getAllChanges(doc)
    .map((c) => A.decodeChange(c))
    .filter((c) => c.actor === actorId && c.hash != null)
    .map((c) => ({ actor: c.actor, seq: c.seq, hash: c.hash as string, deps: c.deps }))
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Apply the patches that invert one change (computed AFTER→BEFORE) as a new
 * change on `doc`. Handles the map/list operations our document graph uses;
 * unknown patch actions are ignored (no-op) rather than throwing, so a partial
 * shape can't break an undo.
 */
function applyInverse<T>(doc: A.Doc<T>, patches: A.Patch[]): A.Doc<T> {
  return A.change(doc, (draft) => {
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
        case "splice":
          if (typeof key === "number" && typeof target === "object") {
            // text splice — not used by the v1 document graph; ignore.
          }
          break;
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

/**
 * Invert the actor's last change and apply it as a new change. Shared by undo
 * (invert your last edit) and redo (invert the undo, restoring the original).
 * Returns the doc unchanged if the actor has no changes.
 */
function invertActorsLastChange<T>(doc: A.Doc<T>, actorId: string): A.Doc<T> {
  const mine = changesByActor(doc, actorId);
  const target = mine[mine.length - 1];
  if (!target) return doc;
  // AFTER→BEFORE diff = the patches that revert this change.
  const inverse = A.diff(doc, [target.hash], target.deps);
  return applyInverse(doc, inverse);
}

/**
 * Undo: revert `actorId`'s last change, applied as a new (mergeable) change.
 * Reverts only that user's change; others' concurrent edits are preserved.
 */
export function undoLastChange<T>(doc: A.Doc<T>, actorId: string): A.Doc<T> {
  return invertActorsLastChange(doc, actorId);
}

/**
 * Redo: re-apply the change the user just undid. Since undo is itself the actor's
 * most recent change, redo inverts THAT — restoring the original effect. A fresh
 * edit by the user makes that edit the last change, so a later redo would target
 * it instead (the "new edit clears the redo stack" behavior, US-010 AC-3).
 */
export function redoLastChange<T>(doc: A.Doc<T>, actorId: string): A.Doc<T> {
  return invertActorsLastChange(doc, actorId);
}
