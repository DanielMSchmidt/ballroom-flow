// Types the test-only bindings injected by vitest.config.ts so the test
// engineer gets `env.TEST_MIGRATIONS` typed from `cloudflare:test`.
// (Harness wiring — PLAN.md §10.3 per-suite D1 / applyD1Migrations seam.)
import type { D1Migration } from "@cloudflare/workers-types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    /** Migrations read from ./migrations at config time. Empty until M2.
     *  Apply per-suite: `await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`. */
    TEST_MIGRATIONS: D1Migration[];
  }
}
