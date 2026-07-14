// OPS — the admin-gated Point-in-Time Recovery route (POST /api/admin/docs/:id/
// restore). The PITR REWIND itself is a real-Cloudflare capability that miniflare
// does not implement (no storage bookmarks), so it is verified against a deployed
// DO, not here — see OPS.md. What IS unit-testable, and what these tests lock, is
// the AUTH GATE + VALIDATION that must never regress: this seam can destructively
// rewind ANY document by ref, so it is gated on the platform-admin flag (NOT doc
// membership) and rejects a malformed recovery point before touching a DO.
import { SELF } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { generateTestKeypair, makeTestJWT, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

function restore(token: string | null, body: unknown): Promise<Response> {
  return SELF.fetch("https://example.com/api/admin/docs/doc_recover/restore", {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

it("401s an unauthenticated caller (no token reaches the admin gate)", async () => {
  const res = await restore(null, { at: "2026-07-01T00:00:00Z" });
  expect(res.status).toBe(401);
});

it("403s an authenticated NON-admin — even a valid recovery point never restores", async () => {
  const userId = "u_restore_member";
  await seedDb({
    users: [{ id: userId, displayName: "Member", identityColor: "#111", plan: "free" }],
  });
  const token = await makeTestJWT(kp, { sub: userId });
  const res = await restore(token, { at: "2026-07-01T00:00:00Z" });
  expect(res.status).toBe(403);
});

it("400s an admin with a missing/malformed recovery point (gate passed, validation caught it)", async () => {
  const userId = "u_restore_admin_badbody";
  await seedDb({
    users: [
      { id: userId, displayName: "Admin", identityColor: "#111", plan: "free", isAdmin: true },
    ],
  });
  const token = await makeTestJWT(kp, { sub: userId });
  // No `at`/`timestamp` at all — a 400 here proves isAdmin passed (else 403) yet
  // no DO was touched (the PITR call miniflare can't service is never reached).
  const res = await restore(token, {});
  expect(res.status).toBe(400);
});

it("400s an admin whose recovery point is in the FUTURE", async () => {
  const userId = "u_restore_admin_future";
  await seedDb({
    users: [
      { id: userId, displayName: "Admin2", identityColor: "#111", plan: "free", isAdmin: true },
    ],
  });
  const token = await makeTestJWT(kp, { sub: userId });
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const res = await restore(token, { at: future });
  expect(res.status).toBe(400);
});
