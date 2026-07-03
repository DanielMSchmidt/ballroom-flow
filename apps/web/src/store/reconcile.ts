// Structural sharing for materialized Automerge snapshots.
// =================================================================
// `A.toJS` rebuilds the WHOLE document as fresh objects on every call, so a
// one-field change (say, appending an annotation to the routine doc) used to
// hand React a snapshot where EVERY section/placement/attribute had a new
// identity — defeating the store seam's referential-stability guards
// (`sameResolvedPlacements`, heads-keyed memoization) and re-rendering the
// entire choreo for a single note.
//
// `reconcile(prev, next)` walks the fresh snapshot against the previous one and
// returns a value in which every subtree that is deep-equal to its predecessor
// IS its predecessor (same reference). Unchanged subtrees keep their identity;
// changed ones (and their ancestors) are new. React/memo equality then sees
// exactly the subtrees that actually changed — the UI never needs to know a
// background CRDT rematerialization happened.
//
// Arrays of entities are matched by `id` (the repo-wide client-ULID identity —
// PLAN §5.3: identity, never position), so an insert/reorder preserves the
// identities of every untouched element; arrays without ids match by index.
// Cost is one O(doc) walk per ACTUAL doc change — the same order as the
// `A.toJS` it piggybacks on, and strictly cheaper than the re-renders it saves.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function hasStringId(v: unknown): v is { id: string } {
  return isPlainObject(v) && typeof v.id === "string";
}

function reconcileArray(prev: unknown[], next: unknown[]): unknown[] {
  // Entity lists (every element carries a string `id`) match by id so inserts/
  // reorders keep untouched elements' identities; otherwise match by index.
  const byId = next.every(hasStringId) && prev.every(hasStringId);
  const prevById = byId ? new Map(prev.map((p) => [(p as { id: string }).id, p])) : null;

  let unchanged = prev.length === next.length;
  const out = next.map((item, i) => {
    const counterpart = prevById ? prevById.get((item as { id: string }).id) : prev[i];
    const merged = reconcile(counterpart, item);
    if (merged !== prev[i]) unchanged = false;
    return merged;
  });
  return unchanged ? prev : out;
}

function reconcileObject(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const nextKeys = Object.keys(next);
  let unchanged = Object.keys(prev).length === nextKeys.length;
  const out: Record<string, unknown> = {};
  for (const k of nextKeys) {
    const merged = reconcile(prev[k], next[k]);
    if (merged !== prev[k]) unchanged = false;
    out[k] = merged;
  }
  return unchanged ? prev : out;
}

/**
 * Return `next` with every subtree that deep-equals its counterpart in `prev`
 * replaced by the `prev` reference (maximal structural sharing). The result is
 * always content-identical to `next`; only identities differ.
 */
export function reconcile<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(prev) && Array.isArray(next)) {
    return reconcileArray(prev, next) as T;
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    return reconcileObject(prev, next) as T;
  }
  return next;
}
