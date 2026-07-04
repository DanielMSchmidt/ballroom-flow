import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Start-from-template journey (US-045). A fresh user (zero owned routines)
// lands on the empty Choreo list, sees the read-only sample ("Golden Waltz
// Basic") and a "Start from template" button, forks it, and lands on a NEW
// owned, editable routine where "Add section" confirms edit rights.
//
// @smoke — part of the CI PR smoke subset.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke start-from-template journey (US-045)", () => {
  test("start from template creates an owned editable copy", async ({ page }) => {
    const user = "user_template";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Template", identityColor: "#aa3355" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // 1. Empty state: the read-only sample card shows "Golden Waltz Basic" with a
    //    "Read-only sample" badge — lazily seeded by GET /api/templates on mount.
    await expect(page.getByText("Golden Waltz Basic")).toBeVisible({ timeout: 15_000 });
    // Badge text confirms the sample is marked read-only in the UI.
    await expect(page.getByText("Read-only sample")).toBeVisible({ timeout: 15_000 });
    // "Start from template" button is visible alongside the sample card.
    await expect(page.getByRole("button", { name: /start from template/i })).toBeVisible();

    // 2. Fork: click "Start from template" → server forks the app template and
    //    navigates to the new owned routine at /routines/:id.
    await page.getByRole("button", { name: /start from template/i }).click();
    await expect(page).toHaveURL(/\/routines\//, { timeout: 15_000 });

    // 3. The fork opened with editor rights: "Add section" is the owner/editor
    //    affordance — it would be absent for a viewer. DO hydration can take a
    //    moment, so use a generous timeout.
    await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({
      timeout: 15_000,
    });
  });
});
