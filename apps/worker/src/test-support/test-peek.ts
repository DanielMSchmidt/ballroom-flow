// Test-only escape hatch for presenting a value as a type the compiler cannot
// verify — the worker analog of packages/domain/src/__fixtures__/invalid.ts:
// ONE loud, greppable helper instead of inline casts scattered through test
// files (CLAUDE.md §4: casts only at boundaries the type system can't express,
// in one small documented helper).
//
// The three sanctioned uses (each call site is one of these):
//   • PEEKING at a Durable Object's PRIVATE internals from a test —
//     `asTestPeek<{ projectToD1(): Promise<void> }>(instance)`. The member
//     exists at runtime; TypeScript hides it only for encapsulation, and we
//     deliberately do NOT make DO members public just for tests.
//   • A STRUCTURAL TEST DOUBLE for a platform interface a test can't construct —
//     `asTestPeek<WebSocket>({ deserializeAttachment: () => … })`. The code
//     under test touches only the faked members; the test's assertions on its
//     behaviour are the runtime proof.
//   • DELIBERATELY MALFORMED input for a NEGATIVE test (a value that is
//     intentionally NOT a T) — the asserted rejection is what makes the lie safe.
//
// Never import this from product code.

/** Present `value` to the compiler as a `T` it cannot prove it to be —
 *  for the three test-only cases in the file header. */
export function asTestPeek<T>(value: unknown): T {
  // biome-ignore lint/plugin: deliberate compiler bypass for tests only — the value carries exactly the runtime members the test exercises (a DO's private internals, a structural platform double, or an intentionally-invalid input); the calling test's runtime assertions back the claim.
  return value as T;
}
