// Type augmentation for the `toHaveNoViolations()` axe matcher.
//
// vitest-axe@0.1.0 ships its augmentation against the legacy global `Vi.Assertion`
// namespace, which vitest 3/4 no longer use (they resolve matchers from the
// `vitest` module's `Assertion`). The matcher IS registered at runtime in
// vitest.setup.ts via `expect.extend(axeMatchers)`; this file just makes vitest's
// type system aware of it so the component a11y tests type-check. vitest-axe's
// own runtime has no vitest-version coupling (it bundles its matcher utils and
// only peers `vitest >=0.16.0`), so it stays compatible under vitest 4.
// Test-support typing only — no config change.
import "vitest";

declare module "vitest" {
  interface Assertion<T = unknown> {
    toHaveNoViolations(): T;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): unknown;
  }
}
