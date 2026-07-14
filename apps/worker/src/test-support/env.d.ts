// Types the test-only bindings injected by vitest.config.ts so the test
// engineer gets `env.TEST_MIGRATIONS` typed from `cloudflare:test`.
// (Harness wiring — PLAN.md §10.3 per-suite D1 / applyD1Migrations seam.)
//
// vitest-pool-workers 4.x types `cloudflare:test`'s `env` as `Cloudflare.Env`
// (the workers-types namespace meant for project declaration-merging) rather
// than the old `ProvidedEnv`. We augment `Cloudflare.Env` via `declare global`
// (this file is a module because of the import below).
import type { D1Migration } from "@cloudflare/workers-types";

declare global {
  namespace Cloudflare {
    interface Env {
      /** Migrations read from ./migrations at config time. Empty until M2.
       *  Apply per-suite: `await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
