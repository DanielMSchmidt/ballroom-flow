import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// GET /api/docs/:id/access — the browser-readable access preflight behind the
// access-denied UI (#178, FE-2). A non-member is told 403 BEFORE the heavy WS
// store opens, so the client can show a calm DENIED state (distinct from the
// offline state) rather than a 1006 that looks like a transient disconnect.
// The WS sync boundary (US-021) is still the real gate — this only informs the UI.
// ─────────────────────────────────────────────────────────────────────────

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe("GET /api/docs/:id/access (denied-state preflight)", () => {
  it("returns the viewer's role for a member", async () => {
    // Arrange: a doc with the caller as a commenter. Act: GET …/access.
    // Assert: 200 with the resolved role (the UI proceeds to open the doc).
    const docRef = "rt_access_member";
    const member = await authedContext({ keypair: kp, userId: "u_m", docRef, role: "commenter" });
    await seedDb({
      users: [{ id: "u_m", displayName: "M", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_owner", doName: docRef }],
      memberships: [{ id: "m_access_member", docRef, userId: "u_m", role: "commenter" }],
    });
    const res = await SELF.fetch(`https://x/api/docs/${docRef}/access`, {
      headers: member.authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "commenter" });
  });

  it("elevates the owner even without a membership row", async () => {
    // The owner (#168) resolves to a role without a membership row → 200.
    const docRef = "rt_access_owner";
    const owner = await authedContext({ keypair: kp, userId: "u_o", docRef, role: null });
    await seedDb({
      users: [{ id: "u_o", displayName: "O", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_o", doName: docRef }],
    });
    const res = await SELF.fetch(`https://x/api/docs/${docRef}/access`, {
      headers: owner.authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "owner" });
  });

  it("forbids a non-member (403 — drives the denied UI)", async () => {
    const docRef = "rt_access_denied";
    const stranger = await authedContext({ keypair: kp, userId: "u_x", docRef, role: null });
    await seedDb({
      users: [{ id: "u_x", displayName: "X", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "u_owner", doName: docRef }],
    });
    const res = await SELF.fetch(`https://x/api/docs/${docRef}/access`, {
      headers: stranger.authHeaders(),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request (401)", async () => {
    const res = await SELF.fetch("https://x/api/docs/rt_anything/access");
    expect(res.status).toBe(401);
  });
});
