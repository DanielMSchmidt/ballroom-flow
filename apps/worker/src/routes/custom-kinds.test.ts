// US-043 — Account custom-kind persistence (REST + D1).
//
// POST /api/account/custom-kinds — create/update a custom attribute kind.
// GET  /api/account/custom-kinds — list the caller's custom kinds.
//
// Mirror the family-notes pattern: server-mediated D1 behind REST, owned by
// the caller (JWT sub). PK (userId, kind) → upsert + indexed per-user GET.
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { expectIndexedQuery } from "../test-support/explain";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

/** A valid custom kind payload for test use. */
const sampleKind = {
  kind: "energy",
  label: "Energy",
  color: "#ff6600",
  cardinality: "single" as const,
  valueType: "enum",
  values: ["low", "high"],
  appliesToDances: ["waltz", "foxtrot"] as string[],
  builtin: false,
};

describe("US-043 account custom-kind persistence", () => {
  it("POST a custom kind → 201; GET returns it (round-trip incl. values + appliesToDances)", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_ck1", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_ck1", displayName: "U1", identityColor: "#111", plan: "free" }],
    });

    const post = await SELF.fetch("https://x/api/account/custom-kinds", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify(sampleKind),
    });
    expect(post.status).toBe(201);

    const get = await SELF.fetch("https://x/api/account/custom-kinds", {
      headers: ctx.authHeaders(),
    });
    expect(get.status).toBe(200);
    const body = await get.json<{ kinds: (typeof sampleKind)[] }>();
    expect(body.kinds).toHaveLength(1);
    expect(body.kinds[0]).toMatchObject({
      kind: "energy",
      label: "Energy",
      color: "#ff6600",
      cardinality: "single",
      valueType: "enum",
      values: ["low", "high"],
      appliesToDances: ["waltz", "foxtrot"],
      builtin: false,
    });
  });

  it("round-trips a free-text kind with NO values/appliesToDances (covers the null + freeText branches)", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_ckft", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_ckft", displayName: "FT", identityColor: "#111", plan: "free" }],
    });

    // freeText:true, valueType "text", no `values`, no `appliesToDances` — exercises
    // the values→null, appliesToDances→null, and freeText→1 (read-back ===1→true) branches.
    const textKind = {
      kind: "mood",
      label: "Mood",
      color: "#3344ff",
      cardinality: "single" as const,
      valueType: "text",
      freeText: true,
      builtin: false,
    };
    const postTrue = await SELF.fetch("https://x/api/account/custom-kinds", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify(textKind),
    });
    expect(postTrue.status).toBe(201);

    // freeText:false on a second kind — exercises the freeText→0 (read-back ===1→false) branch.
    const postFalse = await SELF.fetch("https://x/api/account/custom-kinds", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ ...textKind, kind: "tempo", label: "Tempo", freeText: false }),
    });
    expect(postFalse.status).toBe(201);

    const get = await SELF.fetch("https://x/api/account/custom-kinds", {
      headers: ctx.authHeaders(),
    });
    const body = await get.json<{
      kinds: { kind: string; freeText?: boolean; values?: string[]; appliesToDances?: string[] }[];
    }>();
    const mood = body.kinds.find((k) => k.kind === "mood");
    const tempo = body.kinds.find((k) => k.kind === "tempo");
    expect(mood?.freeText).toBe(true);
    expect(mood?.values).toBeUndefined();
    expect(mood?.appliesToDances).toBeUndefined();
    expect(tempo?.freeText).toBe(false);
  });

  it("POST a reserved/builtin slug → 400", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_ck2", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_ck2", displayName: "U2", identityColor: "#111", plan: "free" }],
    });

    // Reserved slug ("rise" is a builtin WDSF attribute kind)
    const reserved = await SELF.fetch("https://x/api/account/custom-kinds", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ ...sampleKind, kind: "rise" }),
    });
    expect(reserved.status).toBe(400);
    const reservedBody = await reserved.json<{ error: string }>();
    expect(reservedBody.error).toBe("reserved_kind");

    // Builtin flag set to true
    const builtin = await SELF.fetch("https://x/api/account/custom-kinds", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ ...sampleKind, builtin: true }),
    });
    expect(builtin.status).toBe(400);
    const builtinBody = await builtin.json<{ error: string }>();
    expect(builtinBody.error).toBe("reserved_kind");
  });

  it("POST the same slug twice (different label) → GET returns ONE row with the updated label (upsert)", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_ck3", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_ck3", displayName: "U3", identityColor: "#111", plan: "free" }],
    });

    await SELF.fetch("https://x/api/account/custom-kinds", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ ...sampleKind, kind: "intensity" }),
    });
    await SELF.fetch("https://x/api/account/custom-kinds", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ ...sampleKind, kind: "intensity", label: "Intensity Updated" }),
    });

    const get = await SELF.fetch("https://x/api/account/custom-kinds", {
      headers: ctx.authHeaders(),
    });
    expect(get.status).toBe(200);
    const body = await get.json<{ kinds: { kind: string; label: string }[] }>();
    // Exactly one row for this slug — upsert, not append
    const rows = body.kinds.filter((k) => k.kind === "intensity");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("Intensity Updated");
  });

  it("EXPLAIN gate: GET query uses PK prefix (no SCAN)", async () => {
    // PK (userId, kind) → WHERE userId = ?1 is a PK-prefix SEARCH — no full-table SCAN.
    const plan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT kind, label, color, cardinality, valueType, valuesJson, freeText, appliesToDancesJson FROM account_custom_kind WHERE userId = ?1 AND deletedAt IS NULL ORDER BY updatedAt DESC",
    )
      .bind("u1")
      .all<{ detail: string }>();

    // Collect and log the full plan so the report can paste it.
    const details = plan.results.map((r) => r.detail);
    console.info("EXPLAIN plan for GET /api/account/custom-kinds:", details);

    await expectIndexedQuery(
      env.DB,
      "SELECT kind, label, color, cardinality, valueType, valuesJson, freeText, appliesToDancesJson FROM account_custom_kind WHERE userId = ?1 AND deletedAt IS NULL ORDER BY updatedAt DESC",
      ["u1"],
    );
  });

  it("(scope) GET as u2 does not return u1's kinds", async () => {
    const u1 = await authedContext({ keypair: kp, userId: "u_ck4a", docRef: "n/a", role: null });
    const u2 = await authedContext({ keypair: kp, userId: "u_ck4b", docRef: "n/a", role: null });
    await seedDb({
      users: [
        { id: "u_ck4a", displayName: "U4a", identityColor: "#111", plan: "free" },
        { id: "u_ck4b", displayName: "U4b", identityColor: "#222", plan: "free" },
      ],
    });

    // u1 posts a kind
    await SELF.fetch("https://x/api/account/custom-kinds", {
      method: "POST",
      headers: { ...u1.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ ...sampleKind, kind: "scope-test" }),
    });

    // u2 should NOT see u1's kind
    const get = await SELF.fetch("https://x/api/account/custom-kinds", {
      headers: u2.authHeaders(),
    });
    expect(get.status).toBe(200);
    const body = await get.json<{ kinds: { kind: string }[] }>();
    expect(body.kinds.some((k) => k.kind === "scope-test")).toBe(false);
  });
});
