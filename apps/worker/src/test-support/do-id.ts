// ─────────────────────────────────────────────────────────────────────────
// Unique Durable Object id helper — MANDATORY for the worker layer.
//
// WHY (M0.5 finding, PLAN §10.3, DEVELOPMENT.md "Per-test DO-id convention"):
//   vitest-pool-workers runs with `isolatedStorage: false` because SQLite-backed
//   DOs break its isolated-storage teardown. Storage is therefore NOT reset
//   between tests, so EVERY test must address a UNIQUE DO id/name or state leaks
//   between tests. This helper centralizes that so no test forgets.
//
// Usage:
//   import { env } from "cloudflare:test";
//   import { uniqueDocStub } from "../test-support/do-id";
//   const { id, stub } = uniqueDocStub(env.DOC_DO, "routine");
//
// NB: `DOC_DO` is the per-document DO binding added in M2 (wrangler.toml). Until
// then this helper is referenced only inside SKIPPED test bodies, so the missing
// binding never executes. The `DurableObjectNamespace` type is structural here
// to avoid a hard dependency on the not-yet-declared binding type.
// ─────────────────────────────────────────────────────────────────────────

/** Minimal structural view of a DO namespace (avoids importing the M2 binding type). */
export interface DocNamespaceLike<Stub> {
  idFromName(name: string): { toString(): string };
  get(id: { toString(): string }): Stub;
}

/** A fresh, collision-free DO name for this test invocation. */
export function uniqueDocName(prefix = "doc"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Resolve a unique DO stub for a test. Pass the namespace binding (e.g.
 * `env.DOC_DO`) and an optional prefix that makes failures legible
 * ("routine" / "figure" / "account").
 */
export function uniqueDocStub<Stub>(
  namespace: DocNamespaceLike<Stub>,
  prefix = "doc",
): { name: string; id: { toString(): string }; stub: Stub } {
  const name = uniqueDocName(prefix);
  const id = namespace.idFromName(name);
  return { name, id, stub: namespace.get(id) };
}
