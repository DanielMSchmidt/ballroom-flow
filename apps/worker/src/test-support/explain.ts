// ─────────────────────────────────────────────────────────────────────────
// EXPLAIN QUERY PLAN seam (docs/system/architecture.md § Non-functional
// requirements; docs/system/testing.md) — SET UP BY DEVOPS, FILLED BY THE
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
  db: D1Database,
  sql: string,
  params: unknown[] = [],
  opts: ExplainOptions = {},
): Promise<void> {
  // Run EXPLAIN QUERY PLAN and inspect each access path's `detail`.
  const planned = await db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>();

  const details = planned.results.map((r) => r.detail);

  // A full-table scan shows up as "SCAN <table>". A covering-index or indexed
  // search shows "SEARCH … USING [COVERING ]INDEX". We fail on any SCAN that is
  // not explicitly allow-listed (e.g. a tiny reference table).
  const offending = details.filter((detail) => {
    if (!/\bSCAN\b/.test(detail)) return false;
    return !(opts.allow ?? []).some((allowed) => detail.includes(allowed));
  });

  if (offending.length > 0) {
    throw new Error(
      `EXPLAIN QUERY PLAN found a full-table SCAN (index every D1 query — docs/system/architecture.md § Global constraints):\n` +
        `  SQL: ${sql}\n` +
        offending.map((d) => `  ✗ ${d}`).join("\n") +
        `\n  full plan:\n` +
        details.map((d) => `    • ${d}`).join("\n"),
    );
  }
}

/**
 * Convenience for Drizzle query builders: pass anything exposing `toSQL()`
 * ({ sql, params }) and it is fed to `expectIndexedQuery`. Lets a test assert a
 * typed Drizzle query is indexed without hand-writing the SQL string.
 */
export async function expectIndexedDrizzle(
  db: D1Database,
  query: { toSQL(): { sql: string; params: unknown[] } },
  opts: ExplainOptions = {},
): Promise<void> {
  const { sql, params } = query.toSQL();
  await expectIndexedQuery(db, sql, params, opts);
}
