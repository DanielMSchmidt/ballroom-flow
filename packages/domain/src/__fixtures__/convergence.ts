// ─────────────────────────────────────────────────────────────────────────
// Convergence helper for the Automerge property tests (PLAN.md §10.2/§10.3:
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
//   `@automerge/automerge` is a heavy WASM module and (as of this writing) is
//   NOT yet declared as a dependency of @ballroom/domain (it ships in M1 — see
//   TEST-MAP.md "Missing dependencies"). Importing it at the top level would
//   (a) run the WASM on every test collection and (b) throw a resolution error
//   today, breaking the whole (skipped) suite's collection. So we DYNAMIC-IMPORT
//   it inside the async helpers; the helpers are only ever awaited from INSIDE
//   skipped `it`/property bodies, so nothing loads until the suite is unskipped.
//
// Typed structurally to avoid a top-level `import type` from the unresolved
// package (which `verbatimModuleSyntax` would still keep as a module specifier
// for the type-checker to resolve). We model only the surface we use.
// ─────────────────────────────────────────────────────────────────────────

/** The minimal Automerge surface this helper uses (structural, no import). */
export interface AutomergeLike {
  // biome-ignore lint/suspicious/noExplicitAny: Automerge docs are opaque generics by design.
  init<T = any>(): T;
  from<T>(initial: T): T;
  change<T>(doc: T, fn: (d: T) => void): T;
  merge<T>(local: T, remote: T): T;
  getChanges<T>(oldDoc: T, newDoc: T): Uint8Array[];
  applyChanges<T>(doc: T, changes: Uint8Array[]): [T, unknown];
  save<T>(doc: T): Uint8Array;
  load<T>(bytes: Uint8Array): T;
  getHeads<T>(doc: T): string[];
}

/**
 * The Automerge package specifier as a runtime variable (NOT a string literal
 * inside `import(...)`). WHY: the package is not yet declared as a dependency of
 * @ballroom/domain (it ships in M1 — see TEST-MAP.md "Missing dependencies"), so
 * a literal specifier makes `tsc` fail to resolve the module even inside a
 * dynamic import. A variable specifier defers resolution to runtime — which only
 * happens when a skipped test is unskipped AND the dependency exists. Replace
 * this indirection with a normal dynamic import once the dep is added.
 */
const AUTOMERGE_PKG = "@automerge/automerge";

/** Dynamically load Automerge (see file header for why this is lazy). */
export async function loadAutomerge(): Promise<AutomergeLike> {
  const mod = (await import(AUTOMERGE_PKG)) as unknown as AutomergeLike;
  return mod;
}

/** A single mutation a test wants applied to a replica. */
export type Mutation<T> = (doc: T) => void;

/**
 * Apply `mutations` to `doc` as discrete Automerge changes (one change each),
 * returning the new doc. Each change is attributable to one actor, which is
 * what per-user undo (US-010) and convergence-across-actors (US-009) rely on.
 */
export async function applyMutations<T>(doc: T, mutations: Mutation<T>[]): Promise<T> {
  const A = await loadAutomerge();
  let next = doc;
  for (const m of mutations) {
    next = A.change(next, m);
  }
  return next;
}

/**
 * Bring two replicas to convergence by a full bidirectional change exchange and
 * assert they are byte-identical. Returns the converged (merged) doc.
 *
 * Convergence is asserted via `save()` byte-equality, the strongest "same doc"
 * signal Automerge gives (heads can match while pending changes differ).
 */
export async function exchangeAndAssertConverged<T>(
  left: T,
  right: T,
): Promise<{ left: T; right: T; converged: T }> {
  const A = await loadAutomerge();
  const mergedLeft = A.merge(A.merge(A.init<T>(), left), right);
  const mergedRight = A.merge(A.merge(A.init<T>(), right), left);
  assertBytesEqual(A.save(mergedLeft), A.save(mergedRight));
  return { left: mergedLeft, right: mergedRight, converged: mergedLeft };
}

/**
 * Assert that applying `changes` in two different orders yields byte-identical
 * docs (commutativity, US-009). `base` is the common ancestor.
 */
export async function assertCommutative<T>(base: T, changes: Uint8Array[]): Promise<void> {
  const A = await loadAutomerge();
  const forward = changes.reduce<T>((d, c) => A.applyChanges(d, [c])[0], base);
  const reversed = [...changes].reverse().reduce<T>((d, c) => A.applyChanges(d, [c])[0], base);
  assertBytesEqual(A.save(forward), A.save(reversed));
}

/**
 * Assert that applying the SAME change set twice leaves the doc unchanged
 * (idempotence on duplicate delivery — US-009, also the WS-sync invariant US-015).
 */
export async function assertIdempotent<T>(doc: T, changes: Uint8Array[]): Promise<void> {
  const A = await loadAutomerge();
  const once = A.applyChanges(doc, changes)[0];
  const twice = A.applyChanges(once, changes)[0];
  assertBytesEqual(A.save(once), A.save(twice));
}

/** Byte-equality assertion that throws (so it works inside fast-check predicates). */
export function assertBytesEqual(a: Uint8Array, b: Uint8Array): void {
  if (a.length !== b.length || !a.every((byte, i) => byte === b[i])) {
    throw new Error(`Automerge docs did not converge: byte length ${a.length} vs ${b.length}`);
  }
}
