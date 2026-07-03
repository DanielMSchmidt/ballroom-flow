// Component-layer test setup (PLAN.md §10.3). Registers DOM + a11y matchers
// and auto-cleans the DOM between tests. This is harness wiring only — test
// data factories / render helpers belong to the test engineer.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";
import * as axeMatchers from "vitest-axe/matchers";

// `toHaveNoViolations()` for axe assertions.
expect.extend(axeMatchers);

// jsdom's HTMLCanvasElement.getContext throws "Not implemented"; axe-core's
// color-contrast rule probes it and logs a noisy error. Replace it with a
// null-returning stub so a11y output stays clean. (Real color-contrast
// checking happens in the Playwright E2E layer.)
HTMLCanvasElement.prototype.getContext = (() =>
  null) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// jsdom's window.scrollTo logs "Not implemented" — the overlay scroll-lock
// restores the page position on close, which would spam every Sheet/Modal
// test. A quiet no-op keeps output clean; real scroll behavior is E2E's job.
window.scrollTo = (() => {}) as typeof window.scrollTo;

afterEach(() => {
  cleanup();
});
