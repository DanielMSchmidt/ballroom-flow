// Augments the `cloudflare:test` env with the runtime bindings the test
// fixtures use beyond TEST_MIGRATIONS (which the harness already types in
// env.d.ts). These bindings come from wrangler.toml and are present at runtime;
// this file just makes them visible to the test-support TYPES (seedDb, do-id).
//
// Test-support-owned typing only — does not change harness config. `DOC_DO` is
// the per-document Durable Object binding (M2), typed with the REAL DocDO class
// so `env.DOC_DO.get(...)` yields a fully-typed RPC stub in tests — the same
// types production code sees, no mirror interfaces, no casts (CLAUDE.md §4).
//
// vitest-pool-workers 4.x types `cloudflare:test`'s `env` as `Cloudflare.Env`
// (not the old `ProvidedEnv`), so we merge into that namespace via
// `declare global` (this file is a module because of the import below).
//
// NB: D1Database / DurableObjectNamespace here are the AMBIENT GLOBALS (the
// same universe `Env`, `new Request(...)` and cloudflare:test's helpers use) —
// importing them from the "@cloudflare/workers-types" MODULE instead creates a
// parallel type universe whose Request/Headers/stub types don't unify.
import type { DocDO } from "../doc-do";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      /** Per-document SQLite-backed DO (M2, wrangler.toml). */
      DOC_DO: DurableObjectNamespace<DocDO>;
      /** Clerk JWT public PEM — tests inject the test keypair for networkless
       *  verify (US-019 positive auth path). Optional; a secret in prod. */
      CLERK_JWT_KEY?: string;
      /** The raw wrangler.toml text, bound at vitest-config time so config
       *  assertions (ops.test.ts) run against the REAL deploy manifest. */
      WRANGLER_TOML?: string;
    }
  }
}
