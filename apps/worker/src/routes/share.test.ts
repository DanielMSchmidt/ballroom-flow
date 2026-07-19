import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, roleFor, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-024 — Share screen (member list + roles) [M3, user]
// docs/concepts/collaboration.md § Invites. The REST surface behind the Share screen: list members + roles;
// editor/owner removes a member; commenter/viewer cannot. (The visual screen is
// covered at the component layer; here we pin the SERVER authorization + data.)
//
// Endpoints (GET /api/docs/:id/members, DELETE …/members/:userId) are M3 → skipped.
// ─────────────────────────────────────────────────────────────────────────

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe("US-024 Share screen (member list + roles)", () => {
  it("lists members with their roles for a doc", async () => {
    // Intent: the Share screen reads the member+role list from D1.
    // Arrange: seed a routine with editor + commenter + viewer memberships.
    // Act: GET /api/docs/:id/members as the editor. Assert: 200, all three with roles.
    // Covers US-024 AC-1 (member list + roles).
    const docRef = "rt_share";
    const editor = await authedContext({ keypair: kp, userId: "u_ed", docRef, role: "editor" });
    await seedDb({
      users: [
        { id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" },
        { id: "u_co", displayName: "Co", identityColor: "#222", plan: "free" },
        { id: "u_vw", displayName: "Vw", identityColor: "#333", plan: "free" },
      ],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: [
        { id: "m_ed_s1", docRef, userId: "u_ed", role: "editor" },
        { id: "m_co_s1", docRef, userId: "u_co", role: "commenter" },
        { id: "m_vw_s1", docRef, userId: "u_vw", role: "viewer" },
      ],
    });
    const res = await SELF.fetch(`https://x/api/docs/${docRef}/members`, {
      headers: editor.authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ members: Array<{ userId: string; role: string }> }>();
    expect(body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "u_co", role: "commenter" }),
        expect.objectContaining({ userId: "u_vw", role: "viewer" }),
      ]),
    );
  });

  it("resolves a not-onboarded member's name from their cached Clerk identity", async () => {
    // Intent: a member who is logged in but hasn't onboarded (no `users` row) shows
    //   a real name in the roster once they've loaded the app — not the raw id.
    // Arrange: seed a routine + an editor + a profile-less member (users row absent).
    //   The member hits GET /api/me with a Clerk `name` claim, caching their name.
    // Act: GET /api/docs/:id/members as the editor.
    // Assert: the member's displayName is the cached Clerk name, not undefined.
    const docRef = "rt_share_cache";
    const editor = await authedContext({ keypair: kp, userId: "u_edc", docRef, role: "editor" });
    const guest = await authedContext({
      keypair: kp,
      userId: "u_guest",
      docRef,
      role: "commenter",
      claims: { firstName: "Guest", lastName: "Dancer" },
    });
    await seedDb({
      users: [{ id: "u_edc", displayName: "Ed", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_edc", doName: docRef }],
      memberships: [
        { id: "m_edc", docRef, userId: "u_edc", role: "editor" },
        { id: "m_guest", docRef, userId: "u_guest", role: "commenter" },
      ],
    });

    // Before the guest loads the app, their name can't be resolved (no row/cache).
    const before = await SELF.fetch(`https://x/api/docs/${docRef}/members`, {
      headers: editor.authHeaders(),
    });
    const beforeBody = await before.json<{
      members: Array<{ userId: string; displayName?: string }>;
    }>();
    expect(beforeBody.members.find((m) => m.userId === "u_guest")?.displayName).toBeUndefined();

    // The guest loads the app → /api/me caches their Clerk-derived name.
    await SELF.fetch("https://x/api/me", { headers: guest.authHeaders() });

    // Now the roster resolves the guest's cached name.
    const after = await SELF.fetch(`https://x/api/docs/${docRef}/members`, {
      headers: editor.authHeaders(),
    });
    const afterBody = await after.json<{
      members: Array<{ userId: string; displayName?: string }>;
    }>();
    expect(afterBody.members.find((m) => m.userId === "u_guest")?.displayName).toBe("Guest Dancer");
  });

  it("falls back to a not-onboarded member's email when they have no name claim", async () => {
    // Intent: a member whose Clerk token carries an email but no name still shows
    //   something human in the roster (their email), not the raw `user_…` id.
    // Arrange: seed a routine + editor + a profile-less member; the member hits
    //   /api/me with only an `email` claim, caching their email.
    // Act: GET /api/docs/:id/members as the editor.
    // Assert: the member's displayName resolves to their email.
    const docRef = "rt_share_email";
    const editor = await authedContext({ keypair: kp, userId: "u_ede", docRef, role: "editor" });
    const guest = await authedContext({
      keypair: kp,
      userId: "u_mailonly",
      docRef,
      role: "commenter",
      claims: { email: "dancer@example.com" },
    });
    await seedDb({
      users: [{ id: "u_ede", displayName: "Ed", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_ede", doName: docRef }],
      memberships: [
        { id: "m_ede", docRef, userId: "u_ede", role: "editor" },
        { id: "m_mailonly", docRef, userId: "u_mailonly", role: "commenter" },
      ],
    });

    // The guest loads the app → /api/me caches their email (no name to derive).
    await SELF.fetch("https://x/api/me", { headers: guest.authHeaders() });

    const res = await SELF.fetch(`https://x/api/docs/${docRef}/members`, {
      headers: editor.authHeaders(),
    });
    const body = await res.json<{
      members: Array<{ userId: string; displayName?: string }>;
    }>();
    expect(body.members.find((m) => m.userId === "u_mailonly")?.displayName).toBe(
      "dancer@example.com",
    );
  });

  it("lets an editor/owner remove a member", async () => {
    // Intent: editors can remove members (soft-delete the membership).
    // Arrange: seed routine + editor + a viewer to remove. Act: DELETE the viewer
    //   as the editor. Assert: 200; roleFor(doc, viewer) === null afterwards.
    // Covers US-024 AC-2 (editor removes a member).
    const docRef = "rt_share2";
    const editor = await authedContext({ keypair: kp, userId: "u_ed", docRef, role: "editor" });
    await seedDb({
      users: [
        { id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" },
        { id: "u_vw", displayName: "Vw", identityColor: "#333", plan: "free" },
      ],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: [
        { id: "m_ed_s2", docRef, userId: "u_ed", role: "editor" },
        { id: "m_vw_s2", docRef, userId: "u_vw", role: "viewer" },
      ],
    });
    const res = await SELF.fetch(`https://x/api/docs/${docRef}/members/u_vw`, {
      method: "DELETE",
      headers: editor.authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await roleFor(docRef, "u_vw")).toBeNull();
  });

  it("forbids a commenter/viewer from removing a member", async () => {
    // Intent: non-editors cannot manage membership.
    // Arrange: seed routine + a commenter + another member. Act: commenter DELETEs
    //   the other member. Assert: 403; the target's role is unchanged.
    // Covers US-024 AC-2 negative (viewer/commenter cannot remove).
    const docRef = "rt_share3";
    const commenter = await authedContext({
      keypair: kp,
      userId: "u_co",
      docRef,
      role: "commenter",
    });
    await seedDb({
      users: [
        { id: "u_co", displayName: "Co", identityColor: "#222", plan: "free" },
        { id: "u_vw", displayName: "Vw", identityColor: "#333", plan: "free" },
      ],
      docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
      memberships: [
        { id: "m_co_s3", docRef, userId: "u_co", role: "commenter" },
        { id: "m_vw_s3", docRef, userId: "u_vw", role: "viewer" },
      ],
    });
    const res = await SELF.fetch(`https://x/api/docs/${docRef}/members/u_vw`, {
      method: "DELETE",
      headers: commenter.authHeaders(),
    });
    expect(res.status).toBe(403);
    expect(await roleFor(docRef, "u_vw")).toBe("viewer");
  });
});
