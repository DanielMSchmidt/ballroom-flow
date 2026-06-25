import { defineConfig } from "vitest/config";

// Domain layer — pure TS, Node env, in-memory Automerge + fast-check property
// tests (PLAN.md §10.1/§10.3). No network. This is where overlay resolution,
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
      // PLAN.md §10.3: domain ≥ 95%. Not enforced until tests exist (a 95%
      // gate on zero code fails an empty suite). The test engineer uncomments
      // these once the M1 domain suites land.
      thresholds: {
        // lines: 95,
        // functions: 95,
        // branches: 95,
        // statements: 95,
      },
    },
  },
});
