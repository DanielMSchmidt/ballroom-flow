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
    //     "My figures" (a frozen account-figure copy — docs/concepts/figures.md
    //     § Variants).
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
    // The picker lists the dance's library presets; pick the Feather Step. The
    // portion picker (Builder v3 ③) opens with the whole figure pre-selected —
    // confirm to place the live catalog reference.
    await page.getByRole("button", { name: /feather step/i }).click();
    await page.getByRole("button", { name: /add to choreo/i }).click();
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });

    // 3. Create a custom figure, bookmark it from its placement card, and place
    //    it AGAIN from the picker — read-your-writes (docs/system/architecture.md
    //    § D1 — the index & projections): the bookmark lands in the live account
    //    doc instantly, and the picker must list the figure right away, NOT wait
    //    for the alarm-written /api/figures/mine projection to catch up.
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByRole("button", { name: /create my own figure/i }).click();
    await page.getByLabel("Figure name").fill("My Lunge");
    await page.getByLabel("Figure name").press("Enter");
    // The custom mint opens its step editor immediately (create-navigates, §4.3)
    // — close it; this journey drives the bookmark → picker loop.
    await expect(page.getByRole("dialog", { name: /steps · my lunge/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");

    // Bookmark it from the placement card (⟳v5 — a reference, never a copy).
    await page.getByRole("button", { name: /add my lunge to my library/i }).click();
    await expect(page.getByText(/added to your library/i)).toBeVisible({ timeout: 15_000 });

    // The Add-figure picker lists the just-bookmarked figure immediately;
    // tapping places the SAME live figure doc a second time (by ref).
    await page.getByRole("button", { name: "Add figure" }).click();
    const picker = page.getByRole("dialog", { name: /add a figure/i });
    await picker.getByRole("button", { name: /my lunge/i }).click();
    await expect(picker).not.toBeVisible();
    await expect(page.getByRole("button", { name: /edit steps: my lunge/i })).toHaveCount(2, {
      timeout: 15_000,
    });
  });
});
