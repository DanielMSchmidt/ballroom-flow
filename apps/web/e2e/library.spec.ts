import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Figure library (US-032) + the add-from-library picker (US-027). Runs against
// the real worker via the #191 harness. Proves the bundled catalog is browsable
// (the Library tab) and that a routine figure can be placed FROM the library
// (carrying the canonical name), not only typed by hand.
//
// @smoke — FE figure-library slice is done only when this journey is green.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke figure library", () => {
  test("browses the catalog by dance and adds a preset figure to a routine", async ({ page }) => {
    const user = "user_lib";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Lib", identityColor: "#3344ff" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // 1. Browse the library (US-032): the Library tab lists a dance's figures.
    //    The dance filter is a chip row (frames 2.1/2.2) — pick the Foxtrot chip.
    await page.getByRole("button", { name: "Library" }).click();
    await page
      .getByRole("group", { name: /filter by dance/i })
      .getByRole("button", { name: /^foxtrot$/i })
      .click();
    await expect(page.getByRole("heading", { name: /feather step/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    // 1b. Save a global figure to the personal library (T5) and confirm it lands in
    //     "My figures" (a frozen account-figure copy — PLAN §5.2).
    await page.getByRole("button", { name: /save/i }).first().click();
    await expect(page.getByText(/saved to My figures/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("tab", { name: /my figures/i }).click();
    await expect(page.getByText(/not in a choreo yet/i).first()).toBeVisible({ timeout: 15_000 });
    // Re-saving the same figure is idempotent — no duplicate, a gentle toast instead.
    await page.getByRole("tab", { name: /^catalog$/i }).click();
    await page.getByRole("button", { name: /save/i }).first().click();
    await expect(page.getByText(/already in My figures/i)).toBeVisible({ timeout: 15_000 });

    // 2. Create a Foxtrot routine and add the Feather Step FROM the library.
    await page.getByRole("button", { name: "Choreo" }).click();
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Choreo name").fill("Library Foxtrot");
    await page.getByRole("button", { name: "Foxtrot" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /create choreo/i })
      .click();
    await page.getByRole("button", { name: "Add section" }).click({ timeout: 15_000 });
    await page.getByLabel("Section name").fill("Intro");
    await page.getByLabel("Section name").press("Enter");
    await expect(page.getByRole("heading", { name: "Intro" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Add figure" }).click();
    // The picker lists the dance's library presets; pick the Feather Step.
    await page.getByRole("button", { name: /feather step/i }).click();
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
  });
});
