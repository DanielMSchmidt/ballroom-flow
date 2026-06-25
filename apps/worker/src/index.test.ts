import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("health endpoint responds", async () => {
  const res = await SELF.fetch("https://example.com/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

// US-017 Phase 1 — the public WS connect route routes an upgrade to the doc's DO.
it("GET /docs/:id/connect upgrades to a websocket on the doc's DO", async () => {
  const res = await SELF.fetch("https://example.com/docs/rt_sample/connect", {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101); // the DO accepted the Hibernatable WS
  expect(res.webSocket).toBeTruthy();
});

it("GET /docs/:id/connect rejects a non-upgrade request with 426", async () => {
  const res = await SELF.fetch("https://example.com/docs/rt_sample/connect");
  expect(res.status).toBe(426);
});
