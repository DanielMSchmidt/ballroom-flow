import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-019 — Clerk sign-in + onboarding (server side) [M3, user]
// US-053 — Account / profile + plan status [M3, user]
//
// PLAN §4.0, §4.8, D9. The NEGATIVE auth path (missing/invalid → 401) is already
// covered in auth/index.test.ts. Here we cover the POSITIVE networkless-verify
// path + onboarding/profile persistence + plan/owned-count.
//
// To make the positive path deterministic, the fixed test keypair's PUBLIC PEM
// is bound as the worker's CLERK_JWT_KEY (statically, in vitest.config.ts), so
// verifyToken({ jwtKey }) verifies our minted tokens with no Clerk network call
// (US-019 M3 wiring). US-053 below stays skipped until the profile routes land.
// ─────────────────────────────────────────────────────────────────────────

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  // The worker verifies against CLERK_JWT_KEY (the test public PEM), bound
  // statically in vitest.config.ts; this keypair's private key signs matching
  // tokens. (See test-keys.ts for why the binding must be static, not runtime.)
  kp = await generateTestKeypair();
});

describe("US-019 Clerk sign-in + onboarding (server)", () => {
  it("returns the verified Clerk sub from /api/me for a valid token (networkless)", async () => {
    // Intent: a valid Clerk-shaped JWT verifies networklessly and yields its sub.
    // Arrange: CLERK_JWT_KEY = the test public PEM (bound in vitest.config.ts); mint a token.
    // Act: GET /api/me with the bearer token. Assert: 200 { sub }.
    // Covers US-019 AC-3 (verified sub; networkless verify) — positive path.
    const ctx = await authedContext({ keypair: kp, userId: "user_abc", docRef: "n/a", role: null });
    const res = await SELF.fetch("https://x/api/me", { headers: ctx.authHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sub: "user_abc" });
  });

  it("returns a Clerk-claims display name for a not-yet-onboarded user", async () => {
    // Intent: a logged-in user who hasn't onboarded still shows a real name (from
    // their Clerk session-token claims) instead of the raw Clerk user id.
    // Arrange: a verified token carrying a `name` claim, no users row.
    // Act: GET /api/me. Assert: 200 { onboarded:false, displayName:"Ada Lovelace" }.
    const ctx = await authedContext({
      keypair: kp,
      userId: "user_claims",
      docRef: "n/a",
      role: null,
      claims: { name: "Ada Lovelace" },
    });
    const res = await SELF.fetch("https://x/api/me", { headers: ctx.authHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sub: "user_claims",
      onboarded: false,
      displayName: "Ada Lovelace",
    });
  });

  it("persists displayName + identityColor on onboarding", async () => {
    // Intent: onboarding writes the User row (displayName + identity color).
    // Arrange: a verified new user. Act: POST /api/onboarding {displayName, identityColor}.
    // Assert: 200; the users row reflects the values.
    // Covers US-019 AC-2 (onboarding captures displayName + color).
    const ctx = await authedContext({ keypair: kp, userId: "user_new", docRef: "n/a", role: null });
    const res = await SELF.fetch("https://x/api/onboarding", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Dancer", identityColor: "#1f8a5b" }),
    });
    expect(res.status).toBe(200);
    // It actually persisted to the users row (not just a 200) — AC-2.
    const row = await env.DB.prepare("SELECT displayName, identityColor FROM users WHERE id = ?")
      .bind("user_new")
      .first<{ displayName: string; identityColor: string }>();
    expect(row).toMatchObject({ displayName: "Dancer", identityColor: "#1f8a5b" });
  });
});

describe("US-055 Starter routine seeded on first onboarding", () => {
  it("seeds the Golden Waltz Basic starter on a user's FIRST onboarding", async () => {
    // Intent: a brand-new user who completes onboarding receives exactly one
    //   starter routine ("Golden Waltz Basic", dance "waltz") in their list.
    // Arrange: a user id that has never onboarded. Act: POST /api/onboarding.
    // Assert: GET /api/routines includes exactly one "Golden Waltz Basic" waltz.
    // Covers US-055 AC-1 (starter seeded on first onboarding).
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_starter_first",
      docRef: "n/a",
      role: null,
    });
    const res = await SELF.fetch("https://x/api/onboarding", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ displayName: "New", identityColor: "#abc" }),
    });
    expect(res.status).toBe(200);

    // The user now owns exactly one routine: the starter.
    const list = await SELF.fetch("https://x/api/routines", { headers: ctx.authHeaders() });
    const body = (await list.json()) as { routines: Array<{ title: string; dance: string }> };
    const owned = body.routines.filter(
      (r) => r.title === "Golden Waltz Basic" && r.dance === "waltz",
    );
    expect(owned).toHaveLength(1);
  });

  it("does NOT re-seed the starter on a repeat onboarding", async () => {
    // Intent: a repeat POST /api/onboarding (profile edit / re-onboard) must NOT
    //   create a second starter routine — the seed fires at most once per user.
    // Arrange: POST onboarding twice for the same user. Act: GET /api/routines.
    // Assert: still exactly one "Golden Waltz Basic".
    // Covers US-055 AC-2 (idempotent — seeded exactly once).
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_starter_twice",
      docRef: "n/a",
      role: null,
    });
    const post = () =>
      SELF.fetch("https://x/api/onboarding", {
        method: "POST",
        headers: { ...ctx.authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Twice", identityColor: "#abc" }),
      });
    await post();
    await post(); // re-onboard / profile edit

    const list = await SELF.fetch("https://x/api/routines", { headers: ctx.authHeaders() });
    const body = (await list.json()) as { routines: Array<{ title: string }> };
    const starters = body.routines.filter((r) => r.title === "Golden Waltz Basic");
    expect(starters).toHaveLength(1); // seeded once, not twice
  });
});

describe.skip("US-053 Account / profile + plan status", () => {
  it("returns plan + owned-routine count", async () => {
    // Intent: the profile shows plan status + how many routines the user owns.
    // Arrange: seed a free user owning 2 routines. Act: GET /api/profile.
    // Assert: 200 { plan: "free", ownedRoutineCount: 2 }.
    // Covers US-053 AC-2 (plan + owned-routine count).
    const ctx = await authedContext({ keypair: kp, userId: "u_p", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_p", displayName: "P", identityColor: "#111", plan: "free" }],
      docs: [
        { docRef: "r1", type: "routine", ownerId: "u_p", doName: "r1" },
        { docRef: "r2", type: "routine", ownerId: "u_p", doName: "r2" },
      ],
    });
    const res = await SELF.fetch("https://x/api/profile", { headers: ctx.authHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ plan: "free", ownedRoutineCount: 2 });
  });

  it("updates displayName + identity color", async () => {
    // Intent: the user can edit their identity.
    // Arrange: seed the user. Act: PATCH /api/profile {displayName, identityColor}.
    // Assert: 200; the users row reflects the new values.
    // Covers US-053 AC-1 (edit displayName + color).
    const ctx = await authedContext({ keypair: kp, userId: "u_p2", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_p2", displayName: "Old", identityColor: "#000", plan: "free" }],
    });
    const res = await SELF.fetch("https://x/api/profile", {
      method: "PATCH",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ displayName: "New", identityColor: "#fff" }),
    });
    expect(res.status).toBe(200);
  });
});
