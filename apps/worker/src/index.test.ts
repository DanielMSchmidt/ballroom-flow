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

it("health endpoint responds with the deploy build id (null when unset)", async () => {
  const res = await SELF.fetch("https://example.com/api/health");
  expect(res.status).toBe(200);
  // buildId is the stale-bundle handshake: the client compares it against its
  // own VITE_BUILD_ID and reloads onto the new bundle on mismatch. The test
  // env sets no BUILD_ID var, so it must be explicitly null (never absent —
  // the key's presence IS the contract).
  expect(await res.json()).toEqual({ ok: true, buildId: null });
});

// US-017 Phase 1 / US-021 — the public WS connect route forwards an authorized
// upgrade to the doc's DO. Fail-closed (US-021): the client must present a valid
// token AND be a member of the doc; the route forwards the Authorization header
// and sets x-doc-name, then the DO authorizes.
it("GET /api/docs/:id/connect upgrades to a websocket for an authorized member", async () => {
  const docRef = "rt_ws_test"; // distinct from "rt_sample" (reserved for the app-owned template fixture)
  const ctx = await authedContext({ keypair: kp, userId: "u_ed", docRef, role: "editor" });
  await seedDb({
    users: [{ id: "u_ed", displayName: "Ed", identityColor: "#111", plan: "free" }],
    docs: [{ docRef, type: "routine", ownerId: "u_ed", doName: docRef }],
    memberships: ctx.membership ? [ctx.membership] : [],
  });
  const res = await SELF.fetch(`https://example.com/api/docs/${docRef}/connect`, {
    headers: { Upgrade: "websocket", ...ctx.authHeaders() },
  });
  expect(res.status).toBe(101); // the DO accepted the Hibernatable WS
  expect(res.webSocket).toBeTruthy();
});

it("GET /api/docs/:id/connect rejects an unauthenticated connection (fail-closed)", async () => {
  const res = await SELF.fetch("https://example.com/api/docs/rt_sample/connect", {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(401); // US-021: no token → rejected before any role lookup
});

it("GET /api/docs/:id/connect rejects a non-upgrade request with 426", async () => {
  const res = await SELF.fetch("https://example.com/api/docs/rt_sample/connect");
  expect(res.status).toBe(426);
});

// #189 — a browser WS handshake can't set Authorization, so the token rides the
// `ballroom.auth` subprotocol. The route extracts it → forwards as Authorization
// to the DO → the US-021 boundary authenticates it → 101, with the subprotocol
// echoed so the browser completes the handshake.
it("authorizes a connect via the ballroom.auth subprotocol (browser transport)", async () => {
  const docRef = "rt_subproto";
  const ctx = await authedContext({ keypair: kp, userId: "u_sp", docRef, role: "editor" });
  await seedDb({
    users: [{ id: "u_sp", displayName: "Sp", identityColor: "#111", plan: "free" }],
    docs: [{ docRef, type: "routine", ownerId: "u_sp", doName: docRef }],
    memberships: ctx.membership ? [ctx.membership] : [],
  });
  const res = await SELF.fetch(`https://example.com/api/docs/${docRef}/connect`, {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `ballroom.auth, ${ctx.token}` },
  });
  expect(res.status).toBe(101);
  expect(res.headers.get("Sec-WebSocket-Protocol")).toBe("ballroom.auth"); // echoed
});

// Sync-protocol versioning: a current client also offers `ballroom.sync.v1`,
// and the route selects THAT (the auth subprotocol is only the token carrier),
// so both peers can detect the negotiated sync wire version — the escape hatch
// the D10 hard-cutover note reserves. A client that only offers `ballroom.auth`
// (the pre-v1 bundle) still gets `ballroom.auth` echoed (test above); the wire
// format is identical either way.
it("negotiates ballroom.sync.v1 when the client offers it", async () => {
  const docRef = "rt_syncproto";
  const ctx = await authedContext({ keypair: kp, userId: "u_sv", docRef, role: "editor" });
  await seedDb({
    users: [{ id: "u_sv", displayName: "Sv", identityColor: "#111", plan: "free" }],
    docs: [{ docRef, type: "routine", ownerId: "u_sv", doName: docRef }],
    memberships: ctx.membership ? [ctx.membership] : [],
  });
  const res = await SELF.fetch(`https://example.com/api/docs/${docRef}/connect`, {
    headers: {
      Upgrade: "websocket",
      // The version subprotocol must never be mistaken for the token, wherever
      // it sits in the offer list — hence listing it BEFORE the token here.
      "Sec-WebSocket-Protocol": `ballroom.auth, ballroom.sync.v1, ${ctx.token}`,
    },
  });
  expect(res.status).toBe(101);
  expect(res.headers.get("Sec-WebSocket-Protocol")).toBe("ballroom.sync.v1"); // selected
});

it("rejects a subprotocol connect with NO token (401, fail-closed end-to-end)", async () => {
  const res = await SELF.fetch("https://example.com/api/docs/rt_sample/connect", {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": "ballroom.auth" }, // no token
  });
  expect(res.status).toBe(401);
});

it("rejects a subprotocol connect with an INVALID token (401)", async () => {
  const res = await SELF.fetch("https://example.com/api/docs/rt_sample/connect", {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": "ballroom.auth, not-a-real-token" },
  });
  expect(res.status).toBe(401);
});
