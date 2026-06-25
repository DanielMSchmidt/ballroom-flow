import { expect, test } from "@playwright/test";
import { gotoRoutine, seedAuth } from "./support/auth";

// ─────────────────────────────────────────────────────────────────────────
// Permission / quota / invite journeys (PLAN §10.2 E2E: "permission (forged sync
// connection rejected per doc); quota; invite redemption").
//   US-021 — a forged sync connection is rejected (per doc);
//   US-022 — quota: the 4th owned routine → upsell;
//   US-023 — invite redemption grants membership.
// SKIPPED until M3 + screens + E2E auth exist.
// ─────────────────────────────────────────────────────────────────────────

test.describe("permission boundary (forged connection rejected)", () => {
  test.skip(true, "M3 permission boundary + screens + E2E auth not built yet (see TEST-MAP.md)");

  test("a non-member opening a routine is denied (and a forged sync connection is rejected)", async ({
    page,
  }) => {
    // Intent: a user with no membership cannot view or sync a routine (per-doc gate).
    // User scenario: a stranger navigates to a routine they're not a member of.
    // Steps/asserts: seedAuth as stranger; gotoRoutine(rt_sample) → an access-denied
    //   state (no content); the underlying sync connection is rejected (US-021 AC-2/3).
    await seedAuth(page, "user_stranger");
    await gotoRoutine(page, "rt_sample");
    await expect(page.getByText(/don.?t have access|not a member|denied/i)).toBeVisible();
  });
});

test.describe("quota upsell (4th owned routine)", () => {
  test.skip(true, "M3 quota + screens + E2E auth not built yet");

  test("creating a 4th owned routine shows the upsell and does not create it", async ({ page }) => {
    // Intent: the free 3-routine cap is enforced with an upsell.
    // User scenario: a free user who already owns 3 routines tries to create a 4th.
    // Steps/asserts: seedAuth as the at-cap user; click "New Choreo" → choose a dance →
    //   an upsell sheet appears (US-022); the Choreo list still shows 3 routines.
    await seedAuth(page, "user_full");
    await page.goto("/");
    await page.getByRole("button", { name: /new choreo/i }).click();
    await expect(page.getByText(/upgrade|limit|upsell/i)).toBeVisible();
  });
});

test.describe("invite redemption", () => {
  test.skip(true, "M3 invite + screens + E2E auth not built yet");

  test("redeeming a valid invite link grants membership and opens the routine", async ({
    page,
  }) => {
    // Intent: a new user redeems an invite link and gains the chosen role.
    // User scenario: a user opens an invite URL for rt_sample as commenter.
    // Steps/asserts: seedAuth as the invitee; visit /invite/<token>; the routine opens
    //   with commenter affordances (can annotate, cannot edit structure) (US-023 AC-2).
    await seedAuth(page, "user_invitee");
    await page.goto("/invite/inv_valid_token");
    await expect(page).toHaveURL(/routines|invite/);
  });
});
