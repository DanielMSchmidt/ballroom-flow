import { defineConfig } from "vitest/config";

// Component layer — React components in a DOM environment with
// @testing-library/react + vitest-axe (PLAN.md §10.3). jsdom gives a fast,
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
    coverage: {
      provider: "istanbul" as const,
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/main.tsx"],
    },
  },
});
