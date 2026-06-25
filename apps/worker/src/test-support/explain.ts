// ─────────────────────────────────────────────────────────────────────────
// EXPLAIN QUERY PLAN seam (PLAN.md §7, §10.3) — SET UP BY DEVOPS, FILLED BY THE
// TEST ENGINEER.
//
// NFR: "Index every D1 query (EXPLAIN in CI)." Every list/search/registry/
// membership/quota query must hit an index — no full-table SCAN. This module
// is the wiring seam: it defines the helper's *contract* and is exported from
// the worker so the test engineer can implement the body and call it from the
// worker/D1 test suite. CI already runs that suite (see ci.yml "worker/DO/D1"
// step), so once a test using this helper exists, the EXPLAIN gate is live.
//
// HOW IT WORKS (the mechanism this seam standardizes):
//   D1/SQLite exposes `EXPLAIN QUERY PLAN <sql>`, which returns rows whose
//   `detail` column describes each access path, e.g.:
//     "SEARCH membership USING INDEX membership_docRef_idx (docRef=?)"  ✅ index
//     "SCAN membership"                                                 ❌ full scan
//   The assertion: no `detail` may contain "SCAN" (a covering-index/search is
//   required). Allow an opt-out for tiny reference tables if ever needed.
//
// IMPLEMENTATION NOTES FOR THE TEST ENGINEER:
//   • Run against the per-suite isolated D1 binding after applyD1Migrations()
//     (see the seedDb/authedContext fixtures you own).
//   • Drizzle: you can get the compiled SQL + params via `query.toSQL()` and
//     feed them to `env.DB.prepare("EXPLAIN QUERY PLAN " + sql).bind(...params)`.
//   • Keep this helper here (worker/src/test-support) so it ships with the
//     worker tsconfig + lint + the vitest-pool-workers project.
// ─────────────────────────────────────────────────────────────────────────

export interface ExplainOptions {
  /** Substrings allowed to appear even if flagged (e.g. a known tiny ref table). */
  allow?: string[];
}

/**
 * Asserts that running EXPLAIN QUERY PLAN on `sql` (with `params`) against the
 * given D1 database produces NO full-table SCAN — i.e. every access path uses
 * an index. Throws (fails the test) otherwise.
 *
 * SEAM: body intentionally not implemented by DevOps. The test engineer owns
 * the implementation, which builds on the per-suite D1 fixture.
 */
export async function expectIndexedQuery(
  _db: D1Database,
  _sql: string,
  _params: unknown[] = [],
  _opts: ExplainOptions = {},
): Promise<void> {
  throw new Error(
    "expectIndexedQuery: EXPLAIN QUERY PLAN helper not yet implemented — " +
      "the test engineer implements this seam (see apps/worker/src/test-support/explain.ts).",
  );
}
