import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { buildSearchSql } from "../db/routines";
import { authedContext } from "../test-support/authed-context";
import { expectIndexedQuery } from "../test-support/explain";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-046 — Routine + figure search [M7, user]
// US-032 — Application-global figure library browse [M4, user]
// US-033 — Account variants + custom figures in library [M4, user]
//
// PLAN §4.1, §4.2, §10.2: search routines/figures over the D1 index; "EXPLAIN
// shows no SCAN". Library browse reads the registry + FigureType catalog (no
// CRDT scan). Endpoints are M4/M7 product code → skipped.
// ─────────────────────────────────────────────────────────────────────────

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe("US-046 Routine + figure search", () => {
  it("searches routines + figures by title/name/dance over the D1 index", async () => {
    // Intent: search hits the D1 projection, not CRDT content; it spans BOTH
    //   reachable branches — the caller's OWN routines AND app-owned global figures —
    //   and must NOT leak another user's docs.
    // Arrange: seed an app 'Feather' figure, u1's 'My Foxtrot' routine, and u2's
    //   'Secret Quickstep' routine. Act/Assert below.
    // Covers US-046 AC-1 (search by title/name/dance) + scope (app branch, no leak).
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef: "n/a", role: null });
    await seedDb({
      users: [
        { id: "u1", displayName: "U1", identityColor: "#111", plan: "free" },
        { id: "u2", displayName: "U2", identityColor: "#222", plan: "free" },
      ],
      docs: [
        {
          docRef: "fig_f",
          type: "global-figure",
          ownerId: "app",
          doName: "fig_f",
          figureType: "feather",
          dance: "foxtrot",
          title: "Feather",
        },
        {
          docRef: "rt_1",
          type: "routine",
          ownerId: "u1",
          doName: "rt_1",
          dance: "foxtrot",
          title: "My Foxtrot",
        },
        {
          docRef: "rt_u2",
          type: "routine",
          ownerId: "u2",
          doName: "rt_u2",
          dance: "quickstep",
          title: "Secret Quickstep",
        },
      ],
    });

    // Owned-routine branch: u1 finds their own routine.
    const owned = await SELF.fetch("https://x/api/search?q=My", { headers: ctx.authHeaders() });
    expect(owned.status).toBe(200);
    const ownedBody = await owned.json<{ results: { title: string }[] }>();
    expect(ownedBody.results.some((r) => r.title === "My Foxtrot")).toBe(true);

    // App-owned branch (the high-cardinality title_idx path): the global figure is reachable.
    const app = await SELF.fetch("https://x/api/search?q=Feat", { headers: ctx.authHeaders() });
    expect(app.status).toBe(200);
    const appBody = await app.json<{ results: { title: string }[] }>();
    expect(appBody.results.some((r) => r.title === "Feather")).toBe(true);

    // No cross-user leak: u1 must NOT see u2's routine (prefix would match it).
    const leak = await SELF.fetch("https://x/api/search?q=Secret", { headers: ctx.authHeaders() });
    expect(leak.status).toBe(200);
    const leakBody = await leak.json<{ results: { title: string }[] }>();
    expect(leakBody.results.every((r) => r.title !== "Secret Quickstep")).toBe(true);
  });

  it("uses an INDEX for the search query (EXPLAIN, no SCAN)", async () => {
    // Intent: the search query is indexed (NFR "index every D1 query"; CI gate).
    // Arrange: the REAL SQL searchReachable runs (via buildSearchSql — no drift).
    // Act: expectIndexedQuery. Assert: the query plan shows index use, no SCAN
    //   (a TEMP B-TREE for ORDER BY is a SORT, not a SCAN — allowed).
    // Covers US-046 AC-2 (EXPLAIN no SCAN) — the EXPLAIN gate.
    await expectIndexedQuery(env.DB, buildSearchSql(false), ["u1", "feather%"]);
  });

  it("uses an INDEX for the with-dance search variant (EXPLAIN, no SCAN)", async () => {
    // Intent: the dance-filtered variant also hits an index (FIX 6).
    // Covers US-046 AC-2 (EXPLAIN no SCAN) for the AND dance=?3 code path.
    await expectIndexedQuery(env.DB, buildSearchSql(true), ["u1", "feather%", "foxtrot"]);
  });

  it("maps DB type='figure' to 'global-figure' for app-owned figures (FIX 1 regression)", async () => {
    // Intent: production createFigureRows writes type="figure" to the DB. The search
    //   route MUST map it to the contract-valid type before returning so the web
    //   client's zSearchResults.parse doesn't throw and silently empty the results.
    // Arrange: insert a row with the REAL production type="figure", owner="app".
    // Act: GET /api/search?q=<prefix>. Assert: result has type="global-figure".
    const ctx = await authedContext({ keypair: kp, userId: "u_fix1", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_fix1", displayName: "Fix1User", identityColor: "#aaa", plan: "free" }],
    });
    // Insert a figure with the raw production type="figure" (bypassing seedDb's DocType
    // union which only accepts contract-valid types). This simulates createFigureRows.
    await env.DB.prepare(
      "INSERT INTO document_registry (docRef, type, ownerId, doName, figureType, dance, title, updatedAt, deletedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
    )
      .bind(
        "fig_fix1_app",
        "figure",
        "app",
        "fig_fix1_app",
        "feather",
        "foxtrot",
        "ProdFeather",
        Date.now(),
      )
      .run();

    const res = await SELF.fetch("https://x/api/search?q=ProdFeat", {
      headers: ctx.authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ results: { title: string; type: string }[] }>();
    const hit = body.results.find((r) => r.title === "ProdFeather");
    expect(hit).toBeDefined();
    // The route must map "figure"+"app" → "global-figure" (not the raw "figure" which
    // fails zSearchResult.type validation on the client).
    expect(hit?.type).toBe("global-figure");
  });
});

describe("US-032/033 Figure library browse (global + account variants)", () => {
  it("lists global figures grouped by figureType, filterable by dance, from the index", async () => {
    // Intent: the library list reads D1 + the FigureType catalog (no CRDT scan).
    // Arrange: seed global Feather (foxtrot + waltz) + a Three Step. Act: GET
    //   /api/figures?dance=foxtrot. Assert: 200 with the two foxtrot figures grouped.
    // Covers US-032 AC-1 (grouped by figureType, filter by dance) + AC-3 (no CRDT scan).
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }],
      docs: [
        {
          docRef: "srch_ff",
          type: "global-figure",
          ownerId: "app",
          doName: "srch_ff",
          figureType: "feather",
          dance: "foxtrot",
          title: "Feather",
        },
        {
          docRef: "srch_fw",
          type: "global-figure",
          ownerId: "app",
          doName: "srch_fw",
          figureType: "feather",
          dance: "waltz",
          title: "Feather",
        },
        {
          docRef: "srch_ts",
          type: "global-figure",
          ownerId: "app",
          doName: "srch_ts",
          figureType: "three_step",
          dance: "foxtrot",
          title: "Three Step",
        },
      ],
    });
    const res = await SELF.fetch("https://x/api/figures?dance=foxtrot", {
      headers: ctx.authHeaders(),
    });
    expect(res.status).toBe(200);
  });

  it("lists the user's account variants + custom figures with 'used in N routines'", async () => {
    // Intent: my variants/custom figures show lineage + usage count.
    // Arrange: seed an account-figure owned by u1, BOOKMARKED by u1 (⟳v5 — the
    // library is bookmark-driven, not ownership-driven; §4.2/§5.2), referenced by
    // 2 of u1's routines. Act: GET /api/figures/mine. Assert: 200; the variant
    // shows usedInCount: 2. Covers US-033 AC-1 (variants/custom listed) + AC-2
    // ("used in N routines").
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }],
      docs: [
        {
          docRef: "var1",
          type: "account-figure",
          ownerId: "u1",
          doName: "var1",
          figureType: "feather",
          dance: "foxtrot",
          forkedFromRef: "fg_base",
        },
        { docRef: "rtA", type: "routine", ownerId: "u1", doName: "rtA" },
        { docRef: "rtB", type: "routine", ownerId: "u1", doName: "rtB" },
      ],
      placementEdges: [
        { routineRef: "rtA", figureRef: "var1" },
        { routineRef: "rtB", figureRef: "var1" },
      ],
      libraryEntries: [{ userId: "u1", figureRef: "var1" }],
    });
    const res = await SELF.fetch("https://x/api/figures/mine", { headers: ctx.authHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      figures: { docRef: string; usedInCount: number; baseFigureRef: string | null }[];
    };
    const v = body.figures.find((f) => f.docRef === "var1");
    expect(v?.usedInCount).toBe(2);
    expect(v?.baseFigureRef).toBe("fg_base");
  });
});
