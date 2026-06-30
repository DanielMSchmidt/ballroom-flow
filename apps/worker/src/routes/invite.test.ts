import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, roleFor, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-023 — Invite by link (issue + redeem) [M3, user]
// PLAN §5.5, §4.7, §10.2: "invite lifecycle". An editor issues a signed expiring
// token (docRef+role+expiry); redeeming creates a Membership; expired/redeemed/
// non-editor rejected.
//
// REST endpoints (POST /api/docs/:id/invites, POST /api/invites/:token/redeem)
// are M3 product code → bodies skipped.
// ─────────────────────────────────────────────────────────────────────────

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe("US-023 Invite by link (issue + redeem)", () => {
  it("lets an editor issue a signed invite carrying docRef + role + expiry", async () => {
    // Intent: an editor mints a shareable invite for a chosen role.
    // Arrange: seed a routine + editor membership. Act: POST an invite {role:commenter}.
    // Assert: 201 with a token; an invite row exists with that docRef/role/future expiry.
    // Covers US-023 AC-1 (editor issues signed token).
    const docRef = "rt_inv";
    const editor = await authedContext({ keypair: kp, userId: "u_ed", docRef, role: "editor" });
    await seedDb({
      users: [{ id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: editor.membership ? [editor.membership] : [],
    });
    const res = await SELF.fetch(`https://x/api/docs/${docRef}/invites`, {
      method: "POST",
      headers: { ...editor.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ role: "commenter" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ token: expect.any(String) });
  });

  it("creates a Membership with the invite's role on redeem", async () => {
    // Intent: redeeming a valid invite grants the new user the chosen role.
    // Multi-user scenario: editor issues; a DIFFERENT user redeems.
    // Arrange: seed routine + editor; issue an invite for commenter. Act: redeemer
    //   POSTs redeem with their JWT. Assert: 200; roleFor(doc, redeemer) === commenter.
    // Covers US-023 AC-2 (redeem creates Membership).
    const docRef = "rt_inv2";
    const editor = await authedContext({ keypair: kp, userId: "u_ed", docRef, role: "editor" });
    const redeemer = await authedContext({ keypair: kp, userId: "u_new", docRef, role: null });
    await seedDb({
      users: [
        { id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" },
        { id: "u_new", displayName: "New", identityColor: "#222", plan: "free" },
      ],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: editor.membership ? [editor.membership] : [],
      invites: [{ id: "inv_ok", docRef, role: "commenter", expiresAt: Date.now() + 3_600_000 }],
    });
    const res = await SELF.fetch("https://x/api/invites/inv_ok/redeem", {
      method: "POST",
      headers: redeemer.authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await roleFor(docRef, "u_new")).toBe("commenter");
  });

  it("rejects an expired or already-redeemed invite", async () => {
    // Intent: stale invites are unusable.
    // Arrange: seed an expired invite and a redeemed one. Act: redeem each.
    // Assert: both rejected (410/409); no membership created.
    // Covers US-023 AC-3 (expired/redeemed rejected).
    const docRef = "rt_inv3";
    const redeemer = await authedContext({ keypair: kp, userId: "u_late", docRef, role: null });
    await seedDb({
      users: [{ id: "u_late", displayName: "Late", identityColor: "#333", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      invites: [
        { id: "inv_expired", docRef, role: "viewer", expiresAt: Date.now() - 1000 },
        {
          id: "inv_used",
          docRef,
          role: "viewer",
          expiresAt: Date.now() + 3_600_000,
          redeemedAt: Date.now() - 500,
        },
      ],
    });
    const expired = await SELF.fetch("https://x/api/invites/inv_expired/redeem", {
      method: "POST",
      headers: redeemer.authHeaders(),
    });
    const used = await SELF.fetch("https://x/api/invites/inv_used/redeem", {
      method: "POST",
      headers: redeemer.authHeaders(),
    });
    expect([409, 410]).toContain(expired.status);
    expect([409, 410]).toContain(used.status);
    expect(await roleFor(docRef, "u_late")).toBeNull();
  });

  it("forbids a non-editor from issuing an invite", async () => {
    // Intent: only editors/owners may issue invites.
    // Arrange: seed routine + a COMMENTER membership. Act: commenter POSTs an invite.
    // Assert: 403.
    // Covers US-023 AC-4 (non-editor cannot issue).
    const docRef = "rt_inv4";
    const commenter = await authedContext({
      keypair: kp,
      userId: "u_co",
      docRef,
      role: "commenter",
    });
    await seedDb({
      users: [{ id: "u_co", displayName: "Co", identityColor: "#444", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: commenter.membership ? [commenter.membership] : [],
    });
    const res = await SELF.fetch(`https://x/api/docs/${docRef}/invites`, {
      method: "POST",
      headers: { ...commenter.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(res.status).toBe(403);
  });

  // ── Decisions confirmed with the lead (Tester will probe these) ──────────

  it("redeem is upgrade-only — never downgrades an existing member", async () => {
    // Intent: a low-privilege link must not demote a member who already has more.
    // Arrange: an EDITOR member; a viewer invite for that same user.
    // Act: they redeem. Assert: role stays editor (upgrade-only, no downgrade).
    const docRef = "rt_inv5";
    const editor = await authedContext({ keypair: kp, userId: "u_keep", docRef, role: "editor" });
    await seedDb({
      users: [{ id: "u_keep", displayName: "Keep", identityColor: "#555", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: editor.membership ? [editor.membership] : [],
      invites: [{ id: "inv_dwn", docRef, role: "viewer", expiresAt: Date.now() + 3_600_000 }],
    });
    const res = await SELF.fetch("https://x/api/invites/inv_dwn/redeem", {
      method: "POST",
      headers: editor.authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await roleFor(docRef, "u_keep")).toBe("editor"); // not downgraded to viewer
  });

  it("redeem upgrades an existing lower role to the invite's role", async () => {
    // Intent: redeeming a higher-privilege link raises an existing member.
    // Arrange: a VIEWER member; an editor invite for that same user.
    // Act: they redeem. Assert: role becomes editor (single active membership).
    const docRef = "rt_inv6";
    const viewer = await authedContext({ keypair: kp, userId: "u_up", docRef, role: "viewer" });
    await seedDb({
      users: [{ id: "u_up", displayName: "Up", identityColor: "#666", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: viewer.membership ? [viewer.membership] : [],
      invites: [{ id: "inv_up", docRef, role: "editor", expiresAt: Date.now() + 3_600_000 }],
    });
    const res = await SELF.fetch("https://x/api/invites/inv_up/redeem", {
      method: "POST",
      headers: viewer.authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await roleFor(docRef, "u_up")).toBe("editor");
  });

  it("two concurrent redeems of the same token grant EXACTLY ONE membership (#193)", async () => {
    // Intent: single-use is race-safe — two simultaneous redeems of one token must
    //   not double-grant (the atomic redeemedAt claim is the gate, db/invites.ts).
    // Arrange: a valid editor invite + a fresh redeemer. Act: fire two redeems at
    //   once. Assert: exactly one wins (200) + the other is refused (409), and
    //   exactly ONE active membership row exists for the user (no duplicate).
    // Covers US-023 single-use under concurrency (#193).
    const docRef = "rt_inv_race";
    const redeemer = await authedContext({ keypair: kp, userId: "u_race", docRef, role: null });
    await seedDb({
      users: [{ id: "u_race", displayName: "Race", identityColor: "#888", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      invites: [{ id: "inv_race", docRef, role: "editor", expiresAt: Date.now() + 3_600_000 }],
    });
    const fire = () =>
      SELF.fetch("https://x/api/invites/inv_race/redeem", {
        method: "POST",
        headers: redeemer.authHeaders(),
      });
    const [a, b] = await Promise.all([fire(), fire()]);

    // One redeem wins; the other sees the single-use claim already taken.
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    // And exactly ONE active membership row exists — no double-grant.
    const { results } = await env.DB.prepare(
      "SELECT id FROM membership WHERE docRef = ? AND userId = ? AND deletedAt IS NULL",
    )
      .bind(docRef, "u_race")
      .all();
    expect(results.length).toBe(1);
    expect(await roleFor(docRef, "u_race")).toBe("editor");
  });

  // ── Editor-invite downgrade at the editable limit (US-022 × US-023) ──────
  // A free account's routine cap counts the routines they can EDIT (owned +
  // editor-shared). Accepting an editor invite would add another editable
  // routine, so when the redeemer is already at the cap we grant COMMENTER
  // instead of editor and flag the redeem `downgraded` (the client notices).
  // Commenter/viewer access is uncapped, so they can still join — just not edit.

  it("downgrades an editor invite to commenter when the redeemer is at their editable limit", async () => {
    // Arrange: a free redeemer who already OWNS 3 routines (= the cap) is invited
    //   as EDITOR to a 4th (someone else's). Act: redeem.
    // Assert: 200 { downgraded:true, role:"commenter" } and the granted role is
    //   commenter — they joined, but can't edit a 4th routine.
    const docRef = "rt_dg_target";
    const redeemer = await authedContext({ keypair: kp, userId: "u_cap", docRef, role: null });
    await seedDb({
      users: [{ id: "u_cap", displayName: "Cap", identityColor: "#111", plan: "free" }],
      docs: [
        { docRef, type: "routine", ownerId: "u_ed", doName: docRef },
        { docRef: "rt_own1", type: "routine", ownerId: "u_cap", doName: "rt_own1" },
        { docRef: "rt_own2", type: "routine", ownerId: "u_cap", doName: "rt_own2" },
        { docRef: "rt_own3", type: "routine", ownerId: "u_cap", doName: "rt_own3" },
      ],
      invites: [{ id: "inv_dg", docRef, role: "editor", expiresAt: Date.now() + 3_600_000 }],
    });
    const res = await SELF.fetch("https://x/api/invites/inv_dg/redeem", {
      method: "POST",
      headers: redeemer.authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "commenter", downgraded: true });
    expect(await roleFor(docRef, "u_cap")).toBe("commenter");
  });

  it("counts EDITOR-shared routines toward the limit (not just owned)", async () => {
    // Arrange: a free redeemer who owns 1 routine AND is editor on 2 shared ones
    //   (= 3 editable, the cap) is invited as EDITOR to a 4th. Act: redeem.
    // Assert: downgraded to commenter — "routines one can edit" includes shared.
    const docRef = "rt_dg_target2";
    const redeemer = await authedContext({ keypair: kp, userId: "u_mix", docRef, role: null });
    await seedDb({
      users: [{ id: "u_mix", displayName: "Mix", identityColor: "#222", plan: "free" }],
      docs: [
        { docRef, type: "routine", ownerId: "u_ed", doName: docRef },
        { docRef: "rt_mine", type: "routine", ownerId: "u_mix", doName: "rt_mine" },
        { docRef: "rt_sh1", type: "routine", ownerId: "u_ed", doName: "rt_sh1" },
        { docRef: "rt_sh2", type: "routine", ownerId: "u_ed", doName: "rt_sh2" },
      ],
      memberships: [
        { id: "m_sh1", docRef: "rt_sh1", userId: "u_mix", role: "editor" },
        { id: "m_sh2", docRef: "rt_sh2", userId: "u_mix", role: "editor" },
      ],
      invites: [{ id: "inv_mix", docRef, role: "editor", expiresAt: Date.now() + 3_600_000 }],
    });
    const res = await SELF.fetch("https://x/api/invites/inv_mix/redeem", {
      method: "POST",
      headers: redeemer.authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "commenter", downgraded: true });
  });

  it("grants the editor invite in full when the redeemer is BELOW their limit", async () => {
    // Arrange: a free redeemer who owns only 2 routines (under the cap) is invited
    //   as EDITOR to a 3rd. Act: redeem. Assert: editor granted, NOT downgraded.
    const docRef = "rt_room_target";
    const redeemer = await authedContext({ keypair: kp, userId: "u_room", docRef, role: null });
    await seedDb({
      users: [{ id: "u_room", displayName: "Room", identityColor: "#333", plan: "free" }],
      docs: [
        { docRef, type: "routine", ownerId: "u_ed", doName: docRef },
        { docRef: "rt_r1", type: "routine", ownerId: "u_room", doName: "rt_r1" },
        { docRef: "rt_r2", type: "routine", ownerId: "u_room", doName: "rt_r2" },
      ],
      invites: [{ id: "inv_room", docRef, role: "editor", expiresAt: Date.now() + 3_600_000 }],
    });
    const res = await SELF.fetch("https://x/api/invites/inv_room/redeem", {
      method: "POST",
      headers: redeemer.authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "editor", downgraded: false });
    expect(await roleFor(docRef, "u_room")).toBe("editor");
  });

  it("never downgrades a non-editor invite, even at the limit (only edit access is capped)", async () => {
    // Arrange: a redeemer at the cap (3 owned) redeems a COMMENTER invite. Act: redeem.
    // Assert: commenter granted, downgraded:false — commenter/viewer access is uncapped.
    const docRef = "rt_co_target";
    const redeemer = await authedContext({ keypair: kp, userId: "u_co2", docRef, role: null });
    await seedDb({
      users: [{ id: "u_co2", displayName: "Co2", identityColor: "#444", plan: "free" }],
      docs: [
        { docRef, type: "routine", ownerId: "u_ed", doName: docRef },
        { docRef: "rt_c1", type: "routine", ownerId: "u_co2", doName: "rt_c1" },
        { docRef: "rt_c2", type: "routine", ownerId: "u_co2", doName: "rt_c2" },
        { docRef: "rt_c3", type: "routine", ownerId: "u_co2", doName: "rt_c3" },
      ],
      invites: [{ id: "inv_co", docRef, role: "commenter", expiresAt: Date.now() + 3_600_000 }],
    });
    const res = await SELF.fetch("https://x/api/invites/inv_co/redeem", {
      method: "POST",
      headers: redeemer.authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "commenter", downgraded: false });
  });

  it("rejects redeeming an unknown token (404, not a 500)", async () => {
    const redeemer = await authedContext({
      keypair: kp,
      userId: "u_ghost",
      docRef: "x",
      role: null,
    });
    await seedDb({
      users: [{ id: "u_ghost", displayName: "Ghost", identityColor: "#777", plan: "free" }],
    });
    const res = await SELF.fetch("https://x/api/invites/does-not-exist/redeem", {
      method: "POST",
      headers: redeemer.authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});
