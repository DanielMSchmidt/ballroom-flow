// Type augmentation for the `toHaveNoViolations()` axe matcher.
//
// vitest-axe@0.1.0 ships its augmentation against the legacy global `Vi.Assertion`
// namespace, which vitest 3.x no longer uses (vitest 3 resolves matchers from the
// `vitest` module's `Assertion`). The matcher IS registered at runtime in
// vitest.setup.ts via `expect.extend(axeMatchers)`; this file just makes vitest 3's
// type system aware of it so the component a11y tests type-check. Test-support
// typing only — no config change.
import "vitest";

declare module "vitest" {
  interface Assertion<T = unknown> {
    toHaveNoViolations(): T;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): unknown;
  }
}
