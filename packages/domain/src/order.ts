// #63 — Fractional-index ordering keys for sections & placements (docs/system/architecture.md § Ordering).
//
// A `sortKey` is an opaque, lexicographically-ordered string. Giving every
// section and placement one turns a reorder into a FIELD UPDATE — set the moved
// item's `sortKey` to a value strictly between its new neighbours — instead of a
// remove-and-reinsert. Two consequences for CRDT convergence:
//
//   • Concurrent same-list reorders converge by Automerge's per-field merge (the
//     two `sortKey` writes are independent fields on different objects), with a
//     deterministic total order and NO clobbered array splices.
//   • The moved object is never deleted, so a concurrent edit to it survives
//     (the old JSON-copy splice dropped the original object and re-inserted a
//     plain copy, losing any concurrent edit — the #63 limitation).
//
// Implementation: a compact, dependency-free fractional index over a base-62
// digit alphabet — the well-known "midpoint between two strings" construction.
// We deliberately do NOT pull in the `fractional-indexing` npm package: the
// integer-magnitude machinery it adds only matters for unbounded sequential
// inserts, which our small (dozens-per-routine) lists never approach, and a
// vendored 40-line pure function is cheaper to audit and own than a dep.
//
// INVARIANT: a key never ends in the zero digit. This guarantees a strict
// midpoint always exists between any two keys (and before-first / after-last),
// because there is always "room below" to descend into.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS.charAt(0);

/**
 * The lexicographic midpoint strictly between `a` and `b` over {@link DIGITS}.
 * `a` is the (inclusive-exclusive) lower bound — `""` means "before everything";
 * `b` is the upper bound — `null` means "after everything". Neither bound may end
 * in the zero digit (the module invariant), and `a` must sort below `b`.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new Error(`order: lower bound "${a}" is not below upper bound "${b}"`);
  }
  // Carry over any shared leading run, then recurse on the divergent tail
  // (padding `a` with implicit zeros as it runs out).
  if (b !== null) {
    let n = 0;
    while ((a.charAt(n) || ZERO) === b.charAt(n) && n < b.length) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a.charAt(0)) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b.charAt(0)) : DIGITS.length;
  if (digitB - digitA > 1) {
    // Room for a single digit strictly between the two leading digits.
    return DIGITS.charAt(Math.round((digitA + digitB) / 2));
  }
  // Leading digits are consecutive: keep `b`'s lead if it has more to subdivide,
  // else descend into `a`'s tail (appending toward the top of the range).
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return DIGITS.charAt(digitA) + midpoint(a.slice(1), null);
}

/**
 * Generate a key strictly between `a` and `b` (either may be `null` for an open
 * end). `keyBetween(null, null)` is a stable mid-range starting key;
 * `keyBetween(last, null)` appends; `keyBetween(null, first)` prepends.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`order: "${a}" is not before "${b}"`);
  }
  return midpoint(a ?? "", b);
}

/** `n` ascending keys (deterministic) — for migrating/seeding an ordered list. */
export function sequentialKeys(n: number): string[] {
  const keys: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    prev = keyBetween(prev, null);
    keys.push(prev);
  }
  return keys;
}

/** An entity that participates in fractional-index ordering. */
export interface Ordered {
  id: string;
  sortKey?: string;
}

/**
 * Return `items` in `sortKey` order (ascending, tie-broken by `id` for total
 * determinism). FALLBACK: if any item lacks a `sortKey` the list is returned in
 * its existing array order — a legacy doc that predates sortKeys still reads in
 * the order it was authored, until a migration or a reorder backfills keys.
 */
export function sortByOrder<T extends Ordered>(items: readonly T[]): T[] {
  if (items.length === 0 || !items.every((i) => typeof i.sortKey === "string")) {
    return items.slice();
  }
  return items.slice().sort((x, y) => {
    // Past the `every(... typeof === "string")` guard above, both keys are strings;
    // `?? ""` re-expresses that for the closure without an assertion.
    const xk = x.sortKey ?? "";
    const yk = y.sortKey ?? "";
    if (xk !== yk) return xk < yk ? -1 : 1;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

/**
 * Backfill ascending `sortKey`s onto `items` IN their current array order, but
 * ONLY when the whole list lacks keys (a fully-legacy doc). A partially-keyed
 * list is left untouched. Deterministic — every replica that runs this on the
 * same array order assigns the identical keys, so the backfill itself converges.
 * Mutates in place (callers run it inside an Automerge change). Returns whether
 * it assigned any keys.
 */
export function ensureSortKeys<T extends Ordered>(items: T[]): boolean {
  if (items.length === 0 || items.some((i) => typeof i.sortKey === "string")) {
    return false;
  }
  const keys = sequentialKeys(items.length);
  items.forEach((it, i) => {
    it.sortKey = keys[i];
  });
  return true;
}

/**
 * The key to assign to move the item at sorted index `from` to sorted index `to`
 * within `sorted` (already in sortKey order). Returns `null` when the move is a
 * no-op or out of range. `to` is the destination index in the CURRENT sorted
 * order (so moving "down" past one neighbour means `to = from + 1`).
 */
export function keyForMove<T extends Ordered>(
  sorted: readonly T[],
  from: number,
  to: number,
): string | null {
  if (from < 0 || from >= sorted.length || to < 0 || to >= sorted.length || from === to) {
    return null;
  }
  // Land between the two items straddling the destination in sorted order:
  // moving up → between sorted[to-1] and sorted[to]; down → sorted[to] and [to+1].
  const lower = to < from ? to - 1 : to;
  const upper = to < from ? to : to + 1;
  const prevKey = lower >= 0 ? (sorted[lower]?.sortKey ?? null) : null;
  const nextKey = upper < sorted.length ? (sorted[upper]?.sortKey ?? null) : null;

  // Happy path: an open end, or two distinct ordered bounds — `keyBetween` has a
  // strict interval to subdivide.
  if (prevKey === null || nextKey === null || prevKey < nextKey) {
    return keyBetween(prevKey, nextKey);
  }

  // COLLISION: the two straddling neighbours share a `sortKey`. This is real, not
  // a bug: two clients that concurrently append to the same list deterministically
  // mint byte-identical keys (that determinism is what makes the append converge),
  // so a run of equal keys can exist, and `sortByOrder` renders it fine by
  // tie-breaking on `id`. But feeding an equal pair to `keyBetween` would throw
  // (`a` is not before `b`). Since `sorted` is ascending, prevKey >= nextKey here
  // means prevKey === nextKey — a run of equal keys around the destination. Widen
  // OUTWARD past the whole run to the nearest STRICTLY-distinct key on the side the
  // move is heading, giving `keyBetween` a valid interval; the moved item lands just
  // beyond the run on that side and its fresh distinct key breaks the tie for good.
  const runKey = prevKey; // === nextKey
  if (to > from) {
    // Moving down: land just AFTER the run — between runKey and the first key above
    // it that is strictly greater (or the open end).
    let u = upper;
    while (u < sorted.length && (sorted[u]?.sortKey ?? "") <= runKey) u++;
    const above = u < sorted.length ? (sorted[u]?.sortKey ?? null) : null;
    return keyBetween(runKey, above);
  }
  // Moving up: land just BEFORE the run — between the first key below it that is
  // strictly smaller (or the open end) and runKey.
  let l = lower;
  while (l >= 0 && (sorted[l]?.sortKey ?? "") >= runKey) l--;
  const below = l >= 0 ? (sorted[l]?.sortKey ?? null) : null;
  return keyBetween(below, runKey);
}
