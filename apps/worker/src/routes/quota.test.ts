import { env, SELF } from "cloudflare:test";
import { zRoutineList } from "@weavesteps/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { expectIndexedQuery } from "../test-support/explain";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-022 — Quota: 3 owned routines + upsell [M3, user]
// US-025 — Create a routine [M3, user]
//
// docs/concepts/collaboration.md § Plans, quotas & identity, D21;
// docs/system/testing.md: "quota (4th owned routine → upsell)". The quota
// is enforced SERVER-SIDE on create; shared-in routines don't count; the count
// query must be indexed (EXPLAIN, no SCAN).
//
// REST endpoints (POST /api/routines, the quota seam) are M3 product code → the
// bodies are skipped. The minted JWT verifies against CLERK_JWT_KEY.
// ─────────────────────────────────────────────────────────────────────────

let kp: TestKeypair;

beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe("US-025 Create a routine", () => {
  it("creates a routine doc + an owned registry row and returns it in the list", async () => {
    // Intent: creating a routine makes a DO-backed doc + a DocumentRegistry row
    //   that immediately appears (eager projection) in the owner's list.
    // Arrange: a signed-in free user under quota. Act: POST /api/routines {dance,title}.
    // Assert: 201 with a new docRef; GET /api/routines includes it as an owned
    //   routine with the chosen title/dance.
    // Covers US-025 AC-2 (doc + registry row) + AC-3 (appears in list).
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef: "n/a", role: null });
    await seedDb({ users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }] });
    const res = await SELF.fetch("https://x/api/routines", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ dance: "foxtrot", title: "New" }),
    });
    expect(res.status).toBe(201);
    const created = await res.json<{ docRef: string }>();

    const list = await SELF.fetch("https://x/api/routines", { headers: ctx.authHeaders() });
    expect(list.status).toBe(200);
    const { routines } = zRoutineList.parse(await list.json());
    expect(routines).toContainEqual(
      expect.objectContaining({
        docRef: created.docRef,
        title: "New",
        dance: "foxtrot",
        role: "owner",
      }),
    );
  });

  it("rejects an empty/over-long title (shared zCreateRoutine validation, #79)", async () => {
    // Intent: the create endpoint validates against the shared contract schema —
    //   an empty title is refused (no empty doc-name reaches the registry).
    // Covers US-025/#79 (doc-name validation home).
    const ctx = await authedContext({ keypair: kp, userId: "u_v", docRef: "n/a", role: null });
    await seedDb({ users: [{ id: "u_v", displayName: "V", identityColor: "#111", plan: "free" }] });
    const res = await SELF.fetch("https://x/api/routines", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ dance: "waltz", title: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("uses an INDEX for the owned-routine LIST query (EXPLAIN, no SCAN)", async () => {
    // Intent: the owned-list query is indexed (NFR "index every D1 query") — the
    //   document_registry_owner_idx covers the filter AND the updatedAt ordering.
    // Covers US-025 AC (#128) — the EXPLAIN gate via expectIndexedQuery.
    await expectIndexedQuery(
      env.DB,
      "SELECT docRef, title, dance, updatedAt FROM document_registry WHERE ownerId = ? AND type = 'routine' AND deletedAt IS NULL ORDER BY updatedAt DESC",
      ["u1"],
    );
  });
});

describe("US-022 Quota: 3 owned routines + upsell", () => {
  it("blocks the 4th OWNED routine with an upsell (server-side)", async () => {
    // Intent: a free account may own at most 3 routines; the 4th create is blocked.
    // Arrange: seed a user already owning 3 routine registry rows. Act: POST a 4th.
    // Assert: 402/409 with an upsell payload (NOT created).
    // Covers US-022 AC-1 (4th blocked) + AC-3 (enforced server-side).
    const ctx = await authedContext({ keypair: kp, userId: "u_full", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_full", displayName: "Full", identityColor: "#111", plan: "free" }],
      docs: [1, 2, 3].map((n) => ({
        docRef: `rt_owned_${n}`,
        type: "routine" as const,
        ownerId: "u_full",
        doName: `rt_owned_${n}`,
      })),
    });
    const res = await SELF.fetch("https://x/api/routines", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ dance: "waltz", title: "Fourth" }),
    });
    expect([402, 409]).toContain(res.status);
    expect(await res.json()).toMatchObject({ upsell: true });
  });

  it("does NOT count routines shared IN to the user against the cap", async () => {
    // Intent: only OWNED routines count; shared-in ones are free.
    // Arrange: user owns 2 routines + is a member (editor) of a 3rd owned by someone else.
    // Act: POST a 3rd OWNED routine. Assert: 201 (allowed — shared-in didn't count).
    // Covers US-022 AC-2 (shared-in don't count).
    const ctx = await authedContext({ keypair: kp, userId: "u_two", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_two", displayName: "Two", identityColor: "#111", plan: "free" }],
      docs: [
        { docRef: "rt_a", type: "routine", ownerId: "u_two", doName: "rt_a" },
        { docRef: "rt_b", type: "routine", ownerId: "u_two", doName: "rt_b" },
        { docRef: "rt_shared", type: "routine", ownerId: "u_other", doName: "rt_shared" },
      ],
      memberships: [{ id: "m1", docRef: "rt_shared", userId: "u_two", role: "editor" }],
    });
    const res = await SELF.fetch("https://x/api/routines", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ dance: "tango", title: "Third owned" }),
    });
    expect(res.status).toBe(201);
  });

  it("uses an INDEX for the owned-routine count query (EXPLAIN, no SCAN)", async () => {
    // Intent: the quota count query is indexed (NFR "index every D1 query").
    // Arrange: the count SQL the quota seam runs (owned, non-deleted routines).
    // Act: expectIndexedQuery on it. Assert: no full-table SCAN in the plan.
    // Covers US-022 AC-4 (EXPLAIN no SCAN) — the EXPLAIN gate via expectIndexedQuery.
    await expectIndexedQuery(
      env.DB,
      "SELECT COUNT(*) AS n FROM document_registry WHERE ownerId = ? AND type = 'routine' AND deletedAt IS NULL",
      ["u_full"],
    );
  });
});
