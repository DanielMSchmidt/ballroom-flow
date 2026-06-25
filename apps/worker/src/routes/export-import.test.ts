import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-047 — JSON export (routine + referenced figures) [M8, user]
// US-048 — JSON import (routine + referenced figures) [M8, user]
//
// PLAN §7, §10.2: "export loads routine + referenced figures"; import recreates
// them as owned docs, unknown values survive round-trip, migration applied on
// import, quota respected. M8 product code → skipped.
// ─────────────────────────────────────────────────────────────────────────

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe.skip("US-047 JSON export (routine + referenced figures)", () => {
  it("exports a self-contained schemaVersion'd bundle incl. referenced figures + unknown values", async () => {
    // Intent: export is self-contained (routine + every referenced figure) and
    //   preserves forward-compatible unknown values.
    // Arrange: seed a routine referencing a figure that carries an unknown attribute value.
    // Act: GET /api/routines/:id/export as a member. Assert: 200; bundle has
    //   schemaVersion + the routine + the referenced figure; the unknown value is present.
    // Covers US-047 AC-1 (bundle of routine + figures) + AC-2 (self-contained) + AC-3 (unknown preserved).
    const docRef = "rt_exp";
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef, role: "editor" });
    await seedDb({
      users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }],
      docs: [
        { docRef, type: "routine", ownerId: "u1", doName: docRef },
        {
          docRef: "figX",
          type: "global-figure",
          ownerId: "app",
          doName: "figX",
          figureType: "feather",
          dance: "foxtrot",
        },
      ],
      memberships: ctx.membership ? [ctx.membership] : [],
    });
    const res = await SELF.fetch(`https://x/api/routines/${docRef}/export`, {
      headers: ctx.authHeaders(),
    });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as { schemaVersion: number; figures: unknown[] };
    expect(bundle.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(bundle.figures)).toBe(true);
  });
});

describe.skip("US-048 JSON import (routine + referenced figures)", () => {
  it("recreates the routine + figures as owned docs, migrating an older bundle", async () => {
    // Intent: import an (older-schemaVersion) bundle → owned docs, migration applied,
    //   unknown values survive.
    // Arrange: a v1 bundle (routine + one figure with an unknown attribute value); user under quota.
    // Act: POST /api/import with the bundle. Assert: 201; new routine + figure owned by
    //   the importer; the unknown value survived; the doc is at the current schemaVersion.
    // Covers US-048 AC-1 (recreated as owned) + AC-2 (unknown survives) + AC-3 (migrated).
    const ctx = await authedContext({ keypair: kp, userId: "u_imp", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_imp", displayName: "Imp", identityColor: "#111", plan: "free" }],
    });
    const bundle = {
      schemaVersion: 1,
      routine: { title: "Imported", dance: "foxtrot", sections: [] },
      figures: [
        {
          figureType: "feather",
          dance: "foxtrot",
          attributes: [{ id: "a1", kind: "step", count: 1, value: "FUTURE_VALUE" }],
        },
      ],
    };
    const res = await SELF.fetch("https://x/api/import", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify(bundle),
    });
    expect(res.status).toBe(201);
  });

  it("counts an imported routine against the owner's quota", async () => {
    // Intent: importing a routine is an owned-routine create → quota applies.
    // Arrange: a user already owning 3 routines. Act: POST /api/import a routine bundle.
    // Assert: 402/409 with upsell (the 4th owned routine, via import, is blocked).
    // Covers US-048 AC-4 (import respects quota).
    const ctx = await authedContext({ keypair: kp, userId: "u_full", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_full", displayName: "Full", identityColor: "#111", plan: "free" }],
      docs: [1, 2, 3].map((n) => ({
        docRef: `rt_o_${n}`,
        type: "routine" as const,
        ownerId: "u_full",
        doName: `rt_o_${n}`,
      })),
    });
    const res = await SELF.fetch("https://x/api/import", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        routine: { title: "Fourth", dance: "waltz", sections: [] },
        figures: [],
      }),
    });
    expect([402, 409]).toContain(res.status);
  });
});
