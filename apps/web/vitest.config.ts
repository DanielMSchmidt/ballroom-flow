import { defineConfig } from "vitest/config";

// Component layer — React components in a DOM environment with
// @testing-library/react + vitest-axe (docs/system/testing.md § Layer ownership). jsdom gives a fast,
// deterministic DOM for component + a11y assertions; full real-browser
// coverage (PWA install + offline shell) is the Playwright E2E layer's job
// (playwright.config.ts), so we don't pay for browser binaries here.
//
// JSX is transformed by Vitest's esbuild using React 19's automatic runtime —
// no @vitejs/plugin-react needed at test time (Fast Refresh is irrelevant in
// tests, and skipping it sidesteps the app-vite vs vitest-vite version clash).
export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // Load tolerance (the aggregate `pnpm test`/`coverage` scripts serialize the
    // four workspace suites via `--workspace-concurrency=1` so they no longer
    // stampede each other for CPU — see the root package.json). This is the
    // within-suite safety net: on a busy/constrained CI runner a correct render
    // or effect can still transiently run slower than vitest's 5s default and
    // flake a passing test. 15s gives that headroom without masking a real hang
    // (a genuinely stuck test still fails, just later). The axe sweeps keep their
    // own larger per-test ceiling (a11y.test.tsx, AXE_TIMEOUT_MS) since axe is
    // O(DOM nodes) and heavier still.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: "istanbul" as const,
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/main.tsx"],
    },
  },
});
