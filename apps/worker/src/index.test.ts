import { SELF } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { authedContext } from "./test-support/authed-context";
import { generateTestKeypair, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

it("health endpoint responds", async () => {
  const res = await SELF.fetch("https://example.com/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

// US-017 Phase 1 / US-021 — the public WS connect route forwards an authorized
// upgrade to the doc's DO. Fail-closed (US-021): the client must present a valid
// token AND be a member of the doc; the route forwards the Authorization header
// and sets x-doc-name, then the DO authorizes.
it("GET /docs/:id/connect upgrades to a websocket for an authorized member", async () => {
  const docRef = "rt_sample";
  const ctx = await authedContext({ keypair: kp, userId: "u_ed", docRef, role: "editor" });
  await seedDb({
    users: [{ id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" }],
    docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
    memberships: ctx.membership ? [ctx.membership] : [],
  });
  const res = await SELF.fetch(`https://example.com/docs/${docRef}/connect`, {
    headers: { Upgrade: "websocket", ...ctx.authHeaders() },
  });
  expect(res.status).toBe(101); // the DO accepted the Hibernatable WS
  expect(res.webSocket).toBeTruthy();
});

it("GET /docs/:id/connect rejects an unauthenticated connection (fail-closed)", async () => {
  const res = await SELF.fetch("https://example.com/docs/rt_sample/connect", {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(401); // US-021: no token → rejected before any role lookup
});

it("GET /docs/:id/connect rejects a non-upgrade request with 426", async () => {
  const res = await SELF.fetch("https://example.com/docs/rt_sample/connect");
  expect(res.status).toBe(426);
});
