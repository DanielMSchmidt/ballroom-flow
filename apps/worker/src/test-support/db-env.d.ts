// Augments the `cloudflare:test` ProvidedEnv with the runtime bindings the test
// fixtures use beyond TEST_MIGRATIONS (which the harness already types in
// env.d.ts). These bindings come from wrangler.toml and are present at runtime;
// this file just makes them visible to the test-support TYPES (seedDb, do-id).
//
// Test-support-owned typing only — does not change harness config. `DOC_DO` is
// the per-document Durable Object binding (M2), typed with the REAL DocDO class
// so `env.DOC_DO.get(...)` yields a fully-typed RPC stub in tests — the same
// types production code sees, no mirror interfaces, no casts (CLAUDE.md §4).
import type { D1Database, DurableObjectNamespace } from "@cloudflare/workers-types";
import type { DocDO } from "../doc-do";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    /** Per-document SQLite-backed DO (M2, wrangler.toml). */
    DOC_DO: DurableObjectNamespace<DocDO>;
    /** Clerk JWT public PEM — tests inject the test keypair for networkless
     *  verify (US-019 positive auth path). Optional; a secret in prod. */
    CLERK_JWT_KEY?: string;
  }
}
