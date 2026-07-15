import { defineConfig } from "vitest/config";

// Domain layer — pure TS, Node env, in-memory Automerge + fast-check property
// tests (docs/system/testing.md § Layer ownership / § Tooling & CI). No network. This is where overlay resolution,
// fork/copy-on-write, convergence, and history-based undo are proven
// exhaustively + by property, so it carries the highest coverage bar.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
      // docs/system/testing.md § Tooling & CI targets domain ≥ 95%. ARMED at the current measured floor
      // so coverage can't silently regress; ratchet these UP toward 95 as the
      // remaining branches (overlay/undo edge cases, the generated library data
      // blob) get covered. A drop below these fails CI.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 65,
        statements: 90,
      },
    },
  },
});
