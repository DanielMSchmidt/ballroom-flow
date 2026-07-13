// Test-only escape hatch for TEST DOUBLES (partial stand-ins for real interfaces).
//
// Some browser/platform interfaces are genuinely unimplementable in jsdom (a
// DOMRectList, an opaque timer handle) — a test double can only provide the
// members the code under test actually exercises. Presenting such a double as
// the full interface is the one case where stepping outside the type system is
// unavoidable, so the bypass lives here, in one loud, greppable helper, instead
// of inline `as unknown as X` scattered through test files (CLAUDE.md §4: casts
// only at boundaries the type system can't express, in one small documented
// helper — modeled on packages/domain/src/__fixtures__/invalid.ts).
//
// Never import this from product code. The runtime guarantee: the test only
// exercises the members the double provides.

/** Present `value` to the compiler as a full `T` even though it implements only
 *  the members the test exercises — for test doubles only (see file header). */
export function asTestDouble<T>(value: unknown): T {
  // biome-ignore lint/plugin: deliberate compiler bypass for test doubles — the value implements only the members the calling test exercises; jsdom cannot provide the full interface.
  return value as T;
}
