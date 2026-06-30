import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectIndexedQuery } from "./test-support/explain";
import { applyMigrations } from "./test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-049 — Ops: Sentry + Analytics Engine + EXPLAIN gate + Smart Placement [M8]
// PLAN §7, D25/D26, §10.2: errors→Sentry, metrics→Analytics Engine; the CI
// EXPLAIN gate fails on any index/registry/membership/quota SCAN; Smart
// Placement + staging/prod. M8 product code → skipped.
//
// The EXPLAIN-gate assertions below are the CI gate's teeth: every D1 query the
// worker runs in production must be indexed. As routes land, add their compiled
// SQL here (or call expectIndexedDrizzle on the typed query in each route test).
// ─────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await applyMigrations();
});

describe.skip("US-049 EXPLAIN QUERY PLAN gate — every index/registry/membership/quota query is indexed", () => {
  it("membership-by-doc lookup (the DO permission check) is indexed", async () => {
    // Intent: the per-doc role lookup the DO runs on every connection is indexed.
    // Arrange: the membership lookup SQL. Act/Assert: expectIndexedQuery → no SCAN.
    // Covers US-049 AC-2 (EXPLAIN gate) for the permission path.
    await expectIndexedQuery(
      env.DB,
      "SELECT role FROM membership WHERE docRef = ? AND userId = ? AND deletedAt IS NULL",
      ["rt_x", "u1"],
    );
  });

  it("owned-routine list (the Choreo list) is indexed", async () => {
    // Intent: the routine list query is indexed.
    // Covers US-049 AC-2 for the list path.
    await expectIndexedQuery(
      env.DB,
      "SELECT docRef, title, dance, updatedAt FROM document_registry WHERE ownerId = ? AND type = 'routine' AND deletedAt IS NULL ORDER BY updatedAt DESC",
      ["u1"],
    );
  });

  it("invite-by-token lookup (redeem path) is indexed", async () => {
    // Intent: invite redemption looks up by primary key / indexed token.
    // Covers US-049 AC-2 for the invite path.
    await expectIndexedQuery(
      env.DB,
      "SELECT docRef, role, expiresAt, redeemedAt FROM invite WHERE id = ?",
      ["inv1"],
    );
  });
});

describe.skip("US-049 Observability wiring (Sentry + Analytics Engine) + Smart Placement", () => {
  it("reports a thrown error to Sentry and a metric to Analytics Engine", async () => {
    // Intent: errors→Sentry (@sentry/cloudflare), product metrics→Analytics Engine.
    // Arrange: a route that throws (or a metric-emitting route) with the Sentry +
    //   Analytics bindings mocked/captured. Act: hit it. Assert: the Sentry capture
    //   + the AE writeDataPoint were called.
    // Covers US-049 AC-1 (Sentry + Analytics Engine). Bindings (SENTRY_DSN, the AE
    //   dataset) are added with the M8 wiring; until then this documents the contract.
    expect(env).toBeDefined();
  });

  it("declares Smart Placement + staging/prod environments", async () => {
    // Intent: the worker uses Smart Placement; staging + production envs exist.
    // This is a config assertion (wrangler.toml `placement = { mode = "smart" }`
    // + [env.staging]/[env.production]); verified by a config check in M8 CI.
    // Covers US-049 AC-3 (Smart Placement + envs).
    expect(true).toBe(true);
  });
});
