import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Account / profile (US-053). Runs against the real worker via the #191 harness.
// Proves the Profile tab shows plan + owned-routine count and that editing the
// display name persists through the onboarding endpoint (the same call as
// first-run onboarding, US-019). Sign-out is the real Clerk action in prod; here
// we just assert the control is present (the callback is unit-tested).
//
// @smoke — the Profile slice is done when this is green.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke account profile", () => {
  test("shows plan + owned count and persists a display-name edit", async ({ page }) => {
    const user = "user_profile";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Initial", identityColor: "#3344ff" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // Open the Profile tab: plan + owned-routine count show (US-053 AC-2).
    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByText(/free plan/i)).toBeVisible({ timeout: 15_000 });
    // D7 (design 1.18): a free user with a known cap shows "Free · N of M routines".
    await expect(page.getByText(/free · 0 of 3 choreos/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();

    // Edit the display name and save (US-053 AC-1 → POST /api/onboarding).
    await page.getByLabel(/display name/i).fill("Renamed Dancer");
    await page.getByRole("button", { name: /^save$/i }).click();

    // The edit persisted server-side: a reload re-reads it from /api/me.
    await page.reload();
    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByLabel(/display name/i)).toHaveValue("Renamed Dancer", {
      timeout: 15_000,
    });
  });
});
