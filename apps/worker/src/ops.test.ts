import { env, fetchMock } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectIndexedQuery } from "./test-support/explain";
import { applyMigrations } from "./test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-049 — Ops: Sentry + Analytics Engine + EXPLAIN gate + Smart Placement [M8]
// PLAN §7, D25/D26, §10.2: errors→Sentry, metrics→Analytics Engine; the CI
// EXPLAIN gate fails on any index/registry/membership/quota SCAN; Smart
// Placement + staging/prod.
//
// The EXPLAIN-gate assertions below are the CI gate's teeth: every D1 query the
// worker runs in production must be indexed. As routes land, add their compiled
// SQL here (or call expectIndexedDrizzle on the typed query in each route test).
// ─────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await applyMigrations();
});

describe("US-049 EXPLAIN QUERY PLAN gate — every index/registry/membership/quota query is indexed", () => {
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

describe("US-049 Observability wiring (Sentry + Analytics Engine) + Smart Placement", () => {
  beforeAll(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });
  afterAll(() => {
    fetchMock.assertNoPendingInterceptors();
    fetchMock.deactivate();
  });

  it("reports a thrown error to Sentry and a metric to Analytics Engine", async () => {
    // Intent: errors→Sentry (envelope API, dependency-free), product metrics→
    //   Analytics Engine. Arrange: intercept the Sentry ingest host with
    //   fetchMock and capture writeDataPoint on a fake AE binding. Act: run the
    //   ops seam (the same functions app.onError + the /api/* metric middleware
    //   call). Assert: the Sentry envelope POST happened and writeDataPoint was
    //   called with the metric.
    // Covers US-049 AC-1 (Sentry + Analytics Engine).
    const { reportError, writeMetric } = await import("./ops");

    let envelopeBody = "";
    fetchMock
      .get("https://o123.ingest.sentry.io")
      .intercept({
        method: "POST",
        path: "/api/456/envelope/",
        body: (body) => {
          envelopeBody = String(body);
          return true;
        },
      })
      .reply(200, "{}");

    await reportError(
      { SENTRY_DSN: "https://pubkey@o123.ingest.sentry.io/456" },
      new Error("boom"),
      {
        url: "https://x/api/explodes",
        method: "GET",
      },
    );
    // The envelope carries the exception (type + message) and the request context.
    expect(envelopeBody).toContain('"type":"Error"');
    expect(envelopeBody).toContain("boom");
    expect(envelopeBody).toContain("/api/explodes");

    const points: unknown[] = [];
    const dataset = { writeDataPoint: (p: unknown) => void points.push(p) };
    writeMetric(dataset, {
      name: "api_request",
      blobs: ["GET", "/api/health", "200"],
      doubles: [12],
    });
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ blobs: ["api_request", "GET", "/api/health", "200"] });
  });

  it("never throws from the ops seam when bindings are absent (fail-open)", async () => {
    // Intent: observability must never take the request down — no DSN and no AE
    //   binding are silent no-ops (dev/local runs have neither).
    const { reportError, writeMetric } = await import("./ops");
    await expect(reportError({}, new Error("ignored"))).resolves.toBeUndefined();
    expect(() => writeMetric(undefined, { name: "noop" })).not.toThrow();
  });

  it("declares Smart Placement + staging/prod environments + the AE binding", async () => {
    // Intent: the worker uses Smart Placement; staging + production envs exist;
    // the Analytics Engine dataset binding is declared. Asserted against the
    // REAL wrangler.toml (bound as WRANGLER_TOML at vitest-config time), so the
    // deployed config can't silently drop them.
    // Covers US-049 AC-3 (Smart Placement + envs).
    const toml = env.WRANGLER_TOML ?? "";
    expect(toml).toMatch(/\[placement\]\s*\nmode = "smart"/);
    expect(toml).toContain("[env.staging]");
    expect(toml).toContain("[env.production]");
    expect(toml).toContain('binding = "ANALYTICS"');
  });
});
