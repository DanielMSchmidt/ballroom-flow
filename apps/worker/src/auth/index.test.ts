import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

// Negative-path auth tests — deterministic without live Clerk keys.
// The positive path (a real Clerk-issued token → 200 with sub) is exercised
// after provisioning (see PROVISIONING.md) / in M3 with a signed test key.

it("rejects /api/me without a bearer token", async () => {
  const res = await SELF.fetch("https://example.com/api/me");
  expect(res.status).toBe(401);
});

it("rejects /api/me with an invalid token", async () => {
  const res = await SELF.fetch("https://example.com/api/me", {
    headers: { Authorization: "Bearer not-a-real-token" },
  });
  expect(res.status).toBe(401);
});
