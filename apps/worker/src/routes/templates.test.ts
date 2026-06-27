// US-045 — GET /api/templates lists the app-owned sample routine.
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe("US-045 templates", () => {
  it("lists the app-owned sample template", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef: "n/a", role: null });
    await seedDb({ users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }] });
    const res = await SELF.fetch("https://x/api/templates", { headers: ctx.authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json<{ templates: { title: string }[] }>();
    expect(body.templates.length).toBeGreaterThan(0);
  });
});
