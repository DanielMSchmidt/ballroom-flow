// D31 (⟳v5) — the admin seam: the owned-routine quota honours a per-user
// `routineCapOverride` (migration 0014) BEFORE the plan default (routineCapFor),
// and `isAdmin` gates global-figure editing (resolveEffectiveRole, see below).
import { SELF } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { generateTestKeypair, makeTestJWT, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

/** Seed N owned routine registry rows for a user (counts against the quota). */
async function seedOwnedRoutines(userId: string, n: number, prefix: string): Promise<void> {
  const docs = Array.from({ length: n }, (_, i) => ({
    docRef: `${prefix}_${i}`,
    type: "routine" as const,
    ownerId: userId,
    doName: `${prefix}_${i}`,
    title: `R${i}`,
    dance: "waltz",
  }));
  await seedDb({ docs });
}

async function createRoutine(userId: string): Promise<Response> {
  const token = await makeTestJWT(kp, { sub: userId });
  return SELF.fetch("https://example.com/api/routines", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "New routine", dance: "waltz" }),
  });
}

it("blocks a free user at the plan cap (no override) with a 402 upsell", async () => {
  const userId = "u_cap_free";
  await seedDb({
    users: [{ id: userId, displayName: "Free", identityColor: "#111", plan: "free" }],
  });
  await seedOwnedRoutines(userId, 3, "adm_free");
  const res = await createRoutine(userId);
  expect(res.status).toBe(402);
  const body = (await res.json()) as { upsell: boolean; cap: number };
  expect(body.upsell).toBe(true);
  expect(body.cap).toBe(3); // FREE_ROUTINE_CAP
});

it("lets a free user with a routineCapOverride create past the plan cap (D31)", async () => {
  const userId = "u_cap_grant";
  await seedDb({
    users: [
      {
        id: userId,
        displayName: "Granted",
        identityColor: "#111",
        plan: "free",
        routineCapOverride: 5, // admin raised this user's cap
      },
    ],
  });
  await seedOwnedRoutines(userId, 3, "adm_grant"); // already 3 owned — past the plan cap
  const res = await createRoutine(userId);
  expect(res.status).toBe(201); // the override (5) lets the 4th through
});

it("still blocks a user with an override once they reach the RAISED cap", async () => {
  const userId = "u_cap_grant2";
  await seedDb({
    users: [
      {
        id: userId,
        displayName: "Granted2",
        identityColor: "#111",
        plan: "free",
        routineCapOverride: 4,
      },
    ],
  });
  await seedOwnedRoutines(userId, 4, "adm_grant2"); // at the raised cap of 4
  const res = await createRoutine(userId);
  expect(res.status).toBe(402);
  const body = (await res.json()) as { cap: number };
  expect(body.cap).toBe(4); // the raised cap, not the plan default
});
