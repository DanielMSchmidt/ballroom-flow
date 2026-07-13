// Test-only escape hatch for NEGATIVE tests (deliberately malformed input).
//
// Some tests hand a typed function a value that intentionally violates its
// parameter type — a doc missing a required field, a bogus enum value — to
// assert the lenient-read / validation behaviour. That is the one case where
// stepping outside the type system is the POINT of the test, so the bypass
// lives here, in one loud, greppable helper, instead of inline `as never`
// scattered through test files (CLAUDE.md §4: casts only at boundaries the
// type system can't express, in one small documented helper).
//
// Never import this from product code — it exists so a test can lie to the
// compiler ON PURPOSE; the test's runtime assertion is what makes the lie safe.

/** Present `value` to the compiler as a `T` even though it is not one —
 *  for negative tests only (see file header). */
export function asInvalid<T>(value: unknown): T {
  // biome-ignore lint/plugin: deliberate compiler bypass for negative tests — the value is intentionally NOT a T; the calling test asserts the runtime behaviour on malformed input.
  return value as T;
}
