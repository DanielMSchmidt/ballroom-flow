// Augments the `cloudflare:test` ProvidedEnv with the runtime bindings the test
// fixtures use beyond TEST_MIGRATIONS (which the harness already types in
// env.d.ts). These bindings come from wrangler.toml and are present at runtime;
// this file just makes them visible to the test-support TYPES (seedDb, do-id).
//
// Test-support-owned typing only — does not change harness config. `DOC_DO` is
// the per-document Durable Object binding added in M2; typed loosely
// (DurableObjectNamespace) so the (skipped) DO suites compile before the M2
// binding's concrete type exists.
import type { D1Database, DurableObjectNamespace } from "@cloudflare/workers-types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    /** Per-document SQLite-backed DO (M2, wrangler.toml). */
    DOC_DO: DurableObjectNamespace;
  }
}
