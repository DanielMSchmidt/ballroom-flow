import { SELF } from "cloudflare:test";
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
