import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("health endpoint responds", async () => {
  const res = await SELF.fetch("https://example.com/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
