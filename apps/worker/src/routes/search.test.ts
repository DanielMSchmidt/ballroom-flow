import { env, SELF } from "cloudflare:test";
import { type FigureList, zFigureList } from "@ballroom/contract";
import { beforeAll, describe, expect, it } from "vitest";
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

describe.skip("US-046 Routine + figure search", () => {
  it("searches routines + figures by title/name/dance over the D1 index", async () => {
    // Intent: search hits the D1 projection, not CRDT content.
    // Arrange: seed registry rows (a 'Feather' figure + a 'My Foxtrot' routine).
    // Act: GET /api/search?q=feather. Assert: 200 returning the figure row.
    // Covers US-046 AC-1 (search by title/name/dance).
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }],
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
      ],
    });
    const res = await SELF.fetch("https://x/api/search?q=feather", { headers: ctx.authHeaders() });
    expect(res.status).toBe(200);
  });

  it("uses an INDEX for the search query (EXPLAIN, no SCAN)", async () => {
    // Intent: the search query is indexed (NFR "index every D1 query"; CI gate).
    // Arrange: the title/name/dance search SQL. Act: expectIndexedQuery.
    // Assert: the query plan shows index use, no full-table SCAN.
    // Covers US-046 AC-2 (EXPLAIN no SCAN) — the EXPLAIN gate.
    await expectIndexedQuery(
      env.DB,
      "SELECT docRef, type, title, dance FROM document_registry WHERE deletedAt IS NULL AND (title LIKE ?1 OR dance = ?2)",
      ["%feather%", "foxtrot"],
    );
  });
});

describe("US-032/033 Figure library browse (global + account variants)", () => {
  it("lists global figures filterable by dance, from the index", async () => {
    // Intent: the library list reads D1 (no CRDT scan), dance-filterable; grouping
    //   by figureType is the client's concern.
    // Arrange: seed global Feather (foxtrot + waltz) + a Three Step (foxtrot). Act:
    //   GET /api/figures?dance=foxtrot. Assert: 200 with ONLY the two foxtrot figures
    //   (the waltz Feather is filtered out), each scope="global".
    // Covers US-032 AC-1 (filter by dance) + AC-3 (no CRDT scan).
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }],
      docs: [
        {
          docRef: "ff",
          type: "global-figure",
          ownerId: "app",
          doName: "ff",
          figureType: "feather",
          dance: "foxtrot",
          title: "Feather",
        },
        {
          docRef: "fw",
          type: "global-figure",
          ownerId: "app",
          doName: "fw",
          figureType: "feather",
          dance: "waltz",
          title: "Feather",
        },
        {
          docRef: "ts",
          type: "global-figure",
          ownerId: "app",
          doName: "ts",
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
    const { figures } = zFigureList.parse(await res.json()) satisfies FigureList;
    const refs = figures.map((f) => f.docRef).sort();
    expect(refs).toEqual(["ff", "ts"]); // foxtrot only — waltz Feather "fw" filtered out
    expect(figures.every((f) => f.scope === "global")).toBe(true);
    expect(figures.every((f) => f.dance === "foxtrot")).toBe(true);
  });

  it("lists the user's account variants + custom figures with 'used in N routines'", async () => {
    // Intent: my variants/custom figures show lineage + usage count.
    // Arrange: an account-figure variant owned by u1 (base=Telemark via forkedFromRef),
    //   referenced by 2 of u1's routines (two figure_usage edges), + a from-scratch custom.
    // Act: GET /api/figures/mine. Assert: 200; the variant shows usedInCount: 2 +
    //   scope "variant" + baseName "Telemark"; the custom shows scope "custom".
    // Covers US-033 AC-1 (variants/custom + lineage, #56) + AC-2 ("used in N routines").
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }],
      docs: [
        {
          docRef: "base_tel",
          type: "global-figure",
          ownerId: "app",
          doName: "base_tel",
          figureType: "telemark",
          dance: "foxtrot",
          title: "Telemark",
        },
        {
          docRef: "var1",
          type: "account-figure",
          ownerId: "u1",
          doName: "var1",
          figureType: "telemark",
          dance: "foxtrot",
          title: "Open Telemark",
          forkedFromRef: "base_tel",
        },
        {
          docRef: "cust1",
          type: "account-figure",
          ownerId: "u1",
          doName: "cust1",
          figureType: "my_swivel",
          dance: "foxtrot",
          title: "My Swivel",
        },
        { docRef: "rtA", type: "routine", ownerId: "u1", doName: "rtA" },
        { docRef: "rtB", type: "routine", ownerId: "u1", doName: "rtB" },
      ],
      figureUsage: [
        { routineRef: "rtA", figureRef: "var1" },
        { routineRef: "rtB", figureRef: "var1" },
      ],
    });
    const res = await SELF.fetch("https://x/api/figures/mine", { headers: ctx.authHeaders() });
    expect(res.status).toBe(200);
    const { figures } = zFigureList.parse(await res.json()) satisfies FigureList;
    const variant = figures.find((f) => f.docRef === "var1");
    expect(variant).toMatchObject({ scope: "variant", baseName: "Telemark", usedInCount: 2 });
    const custom = figures.find((f) => f.docRef === "cust1");
    expect(custom).toMatchObject({ scope: "custom", usedInCount: 0 });
  });

  it("uses an INDEX for the global browse + usage-count queries (EXPLAIN, no SCAN)", async () => {
    // Intent: the library queries are indexed (NFR "index every D1 query"; CI gate).
    // Covers US-032/033 AC-3 (no CRDT scan, served by document_registry_type_idx +
    // figure_usage_figure_idx).
    await expectIndexedQuery(
      env.DB,
      "SELECT docRef, title, figureType, dance FROM document_registry WHERE type = ?1 AND dance = ?2 AND deletedAt IS NULL",
      ["global-figure", "foxtrot"],
    );
    await expectIndexedQuery(
      env.DB,
      "SELECT figureRef, COUNT(DISTINCT routineRef) AS n FROM figure_usage WHERE figureRef IN (?1, ?2) AND deletedAt IS NULL GROUP BY figureRef",
      ["var1", "cust1"],
    );
  });
});
