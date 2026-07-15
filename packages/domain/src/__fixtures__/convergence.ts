// ─────────────────────────────────────────────────────────────────────────
// Convergence helper for the Automerge property tests (docs/system/testing.md:
// "convergence asserted by exchanging changes"; US-009).
//
// Models two (or N) replicas of one Automerge document, lets a test apply
// random / partitioned mutation sequences to each independently, then exchanges
// changes and asserts the CRDT invariants:
//   • convergence   — after a full exchange both replicas are byte-identical;
//   • commutativity — merge order does not matter;
//   • idempotence   — re-applying an already-seen change is a no-op.
//
// IMPORTANT — lazy Automerge load:
//   `@automerge/automerge` is a heavy WASM module; importing it at the top
//   level would run the WASM on every test collection. So the helpers
//   DYNAMIC-IMPORT it inside their async bodies — they are only ever awaited
//   from INSIDE `it`/property bodies, so nothing loads until a test runs.
//   (Type-only imports below are erased and load nothing.)
// ─────────────────────────────────────────────────────────────────────────

import type { Doc } from "@automerge/automerge";

/** The real Automerge module surface — `@automerge/automerge` has been a
 *  declared dependency since M1 landed, so no structural mirror is needed. */
export type AutomergeLike = typeof import("@automerge/automerge");

/**
 * Dynamically load Automerge. The import stays INSIDE the function body (never
 * top-level) so the heavy WASM module is not executed on test collection —
 * helpers are only awaited from inside `it`/property bodies. Fully typed via
 * the real module: no cast, no drift.
 */
export async function loadAutomerge(): Promise<AutomergeLike> {
  return import("@automerge/automerge");
}

/** A single mutation a test wants applied to a replica. */
export type Mutation<T> = (doc: T) => void;

/**
 * Apply `mutations` to `doc` as discrete Automerge changes (one change each),
 * returning the new doc. Each change is attributable to one actor, which is
 * what per-user undo (US-010) and convergence-across-actors (US-009) rely on.
 *
 * The input `doc` is `clone`d first so the caller can keep using it as a shared
 * base for ANOTHER replica — Automerge 3.x marks a doc "outdated" once it has
 * been changed/merged, so the same base reference can't be mutated twice.
 */
export async function applyMutations<T>(doc: Doc<T>, mutations: Mutation<T>[]): Promise<Doc<T>> {
  const A = await loadAutomerge();
  let next = A.clone(doc);
  for (const m of mutations) {
    next = A.change(next, m);
  }
  return next;
}

/**
 * Bring two replicas to convergence by a full bidirectional change exchange and
 * assert they are byte-identical. Returns the converged (merged) doc.
 *
 * Convergence is asserted via HEADS equality (the set of current change hashes)
 * — Automerge's canonical "same logical state" signal, which is independent of
 * merge order. NB: `save()` bytes are NOT canonical across merge orders (two
 * docs with identical heads/content can serialize to different bytes), so a raw
 * byte comparison would spuriously fail here; heads are the right invariant.
 */
export async function exchangeAndAssertConverged<T>(
  left: Doc<T>,
  right: Doc<T>,
): Promise<{ left: Doc<T>; right: Doc<T>; converged: Doc<T> }> {
  const A = await loadAutomerge();
  // Clone each replica before merging — merge marks its local arg outdated, and
  // both `left` and `right` are merged twice (once per direction).
  const mergedLeft = A.merge(A.merge(A.init<T>(), A.clone(left)), A.clone(right));
  const mergedRight = A.merge(A.merge(A.init<T>(), A.clone(right)), A.clone(left));
  assertHeadsEqual(A, mergedLeft, mergedRight);
  return { left: mergedLeft, right: mergedRight, converged: mergedLeft };
}

/**
 * Assert that applying `changes` in two different orders converges to the same
 * logical state (commutativity, US-009). `base` is the common ancestor.
 */
export async function assertCommutative<T>(base: Doc<T>, changes: Uint8Array[]): Promise<void> {
  const A = await loadAutomerge();
  // Each fold consumes its accumulator and reuses `base`, so clone `base` per
  // fold (Automerge 3.x: a doc is outdated after applyChanges).
  const forward = changes.reduce<Doc<T>>((d, c) => A.applyChanges(d, [c])[0], A.clone(base));
  const reversed = [...changes]
    .reverse()
    .reduce<Doc<T>>((d, c) => A.applyChanges(d, [c])[0], A.clone(base));
  assertHeadsEqual(A, forward, reversed);
}

/**
 * Assert that applying the SAME change set twice leaves the doc unchanged
 * (idempotence on duplicate delivery — US-009, also the WS-sync invariant US-015).
 */
export async function assertIdempotent<T>(doc: Doc<T>, changes: Uint8Array[]): Promise<void> {
  const A = await loadAutomerge();
  const once = A.applyChanges(A.clone(doc), changes)[0];
  const twice = A.applyChanges(once, changes)[0];
  assertHeadsEqual(A, once, twice);
}

/**
 * Assert two docs have converged to the same logical state by comparing sorted
 * heads (the set of current change hashes — order-independent). Throws so it
 * works inside fast-check predicates.
 */
export function assertHeadsEqual<T>(A: AutomergeLike, a: Doc<T>, b: Doc<T>): void {
  const ha = [...A.getHeads(a)].sort();
  const hb = [...A.getHeads(b)].sort();
  const equal = ha.length === hb.length && ha.every((h, i) => h === hb[i]);
  if (!equal) {
    throw new Error(`Automerge docs did not converge: heads [${ha}] vs [${hb}]`);
  }
}

/** Byte-equality assertion that throws (so it works inside fast-check predicates). */
export function assertBytesEqual(a: Uint8Array, b: Uint8Array): void {
  if (a.length !== b.length || !a.every((byte, i) => byte === b[i])) {
    throw new Error(`Automerge docs did not converge: byte length ${a.length} vs ${b.length}`);
  }
}
