import { expect, test } from "@playwright/test";
import { gotoRoutine, seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Permission / quota / invite journeys (PLAN §10.2 E2E: "permission (forged sync
// connection rejected per doc); quota; invite redemption"). Runs against the REAL
// worker (D1 + per-document Durable Objects + the fail-closed auth/sync boundary)
// via the #191 E2E harness — real test JWTs, the real US-021 boundary.
//   US-021 — a non-member opening a routine is denied (per doc);
//   US-022 — quota: the 4th owned routine → upsell (and isn't created);
//   US-023 — invite redemption grants membership and opens the routine.
//
// @smoke — part of the CI PR smoke subset (FE-2 is done only when this is green).
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke permission boundary (non-member denied)", () => {
  test("a non-member opening a routine sees a calm access-denied state (US-021)", async ({
    page,
  }) => {
    // Intent: a user with no membership cannot open a routine (the per-doc gate),
    //   and is told so explicitly — distinct from an offline/connectivity state.
    // Scenario: a stranger deep-links to a routine owned by someone else.
    const owner = "user_owner";
    const stranger = "user_stranger";
    const docRef = "rt_sample";
    await resetDb(page);
    await seedDb(page, {
      users: [
        { id: owner, displayName: "Owner", identityColor: "#111111" },
        { id: stranger, displayName: "Stranger", identityColor: "#222222" },
      ],
      docs: [{ docRef, type: "routine", ownerId: owner, title: "Private Routine", dance: "waltz" }],
    });
    await seedAuth(page, stranger);
    await gotoRoutine(page, docRef);

    // The access preflight (GET …/access → 403) surfaces the denied state; the
    // underlying WS sync is also fail-closed (US-021 AC-2/3) — defence in depth.
    await expect(page.getByRole("heading", { name: /don.?t have access/i })).toBeVisible({
      timeout: 15_000,
    });
    // It must NOT show editing affordances for a denied routine.
    await expect(page.getByRole("button", { name: "Add section" })).toHaveCount(0);
  });
});

test.describe("@smoke quota upsell (4th owned routine)", () => {
  test("creating a 4th owned routine shows the upsell and does not create it (US-022)", async ({
    page,
  }) => {
    // Intent: the free 3-routine cap is enforced with an upsell sourced from the
    //   server (the cap is on /api/me; the create 402 enforces the same value).
    // Scenario: a free user who already owns 3 routines tries to create a 4th.
    const user = "user_full";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Full", identityColor: "#333333", plan: "free" }],
      docs: [1, 2, 3].map((n) => ({
        docRef: `rt_full_${n}`,
        type: "routine",
        ownerId: user,
        title: `Routine ${n}`,
        dance: "waltz",
      })),
    });
    await seedAuth(page, user);
    await page.goto("/");

    // The three owned routines list; New Choreo at cap → the upsell (NOT the form).
    await expect(page.getByText("Routine 1")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /new choreo/i }).click();
    await expect(page.getByText(/upgrade|limit|upsell/i)).toBeVisible();
    // The create form did NOT open (no routine is being created).
    await expect(page.getByLabel("Routine name")).toHaveCount(0);
  });
});

test.describe("@smoke invite redemption", () => {
  test("redeeming a valid invite link grants membership and opens the routine (US-023)", async ({
    page,
  }) => {
    // Intent: a user redeems an invite link and gains the chosen role on the doc.
    // Scenario: an invitee opens an invite URL for rt_sample as commenter.
    const owner = "user_owner";
    const invitee = "user_invitee";
    const docRef = "rt_sample";
    const token = "inv_valid_token";
    await resetDb(page);
    await seedDb(page, {
      users: [
        { id: owner, displayName: "Owner", identityColor: "#111111" },
        { id: invitee, displayName: "Invitee", identityColor: "#444444" },
      ],
      docs: [{ docRef, type: "routine", ownerId: owner, title: "Shared Routine", dance: "waltz" }],
      invites: [{ id: token, docRef, role: "commenter", expiresAt: Date.now() + 86_400_000 }],
    });
    await seedAuth(page, invitee);
    await page.goto(`/invite/${token}`);

    // Redemption deep-links into the joined routine; the invitee (now a commenter
    // member) is allowed IN — not denied — and views it read-only. (The header
    // reads "Untitled routine" because test-seed projects only the D1 index, not
    // the CRDT doc — the doc is empty until a real create seeds it.)
    await expect(page).toHaveURL(/\/routines\/rt_sample/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /untitled routine/i })).toBeVisible({
      timeout: 15_000,
    });
    // Not denied, and commenter ≠ editor → no structural-edit affordances.
    await expect(page.getByRole("heading", { name: /don.?t have access/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add section" })).toHaveCount(0);
  });
});
