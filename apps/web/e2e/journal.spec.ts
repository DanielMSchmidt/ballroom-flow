import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// T6 Journal journey (PLAN §2.6/§2.7/§4.6 E2E). Runs against the REAL worker
// (D1 + per-document Durable Objects + the cross-routine journal_entry index)
// via the #191 harness — no live Clerk, a real test JWT, the real DO alarm
// projection. Proves the projection + read end-to-end: a lesson authored in a
// figure's annotation panel (US-039) surfaces cross-routine in the Journal tab.
//
// @smoke — part of the CI PR smoke subset.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke journal journey", () => {
  test("empty state → notate a lesson → it surfaces in Journal → filters", async ({ page }) => {
    test.setTimeout(120_000);
    const user = "user_journal";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Journaler", identityColor: "#1f8a5b" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    const rail = page.getByRole("navigation", { name: /primary navigation/i });

    // Journal tab starts on the designed empty state (frame 3.2).
    await rail.getByRole("button", { name: "Journal" }).click();
    await expect(page.getByText("No entries yet")).toBeVisible({ timeout: 15_000 });

    // Create a routine + a figure to notate (US-025/026/027).
    await rail.getByRole("button", { name: "Choreo" }).click();
    await page.getByRole("button", { name: /new choreo/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Choreo name").fill("E2E Journal");
    await dialog.getByRole("button", { name: "Waltz", exact: true }).click();
    await dialog.getByRole("button", { name: /create choreo/i }).click();

    const addSection = page.getByRole("button", { name: "Add section" });
    await expect(addSection).toBeVisible({ timeout: 15_000 });
    await addSection.click();
    await page.getByLabel("Section name").fill("Intro");
    await page.getByLabel("Section name").press("Enter");
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByLabel("Figure name").fill("Natural Turn");
    await page.getByLabel("Figure name").press("Enter");
    await expect(page.getByText("Natural Turn")).toBeVisible({ timeout: 15_000 });

    // Open the figure's step sheet → the annotation panel; author a LESSON.
    await page.getByRole("button", { name: /edit steps: Natural Turn/i }).click();
    const panel = page.getByRole("region", { name: /^annotations$/i });
    await panel.getByLabel("Kind").selectOption("lesson");
    await panel.getByRole("textbox", { name: /^note$/i }).fill("heads stay left");
    await panel.getByRole("button", { name: /add note/i }).click();
    await expect(panel.getByText("heads stay left")).toBeVisible({ timeout: 15_000 });

    // Close the figure step sheet so the nav rail isn't behind its modal scrim.
    await page.keyboard.press("Escape");

    // Return to Journal — the lesson surfaces cross-routine (projected by the DO
    // alarm). Re-enter the tab on each poll to refetch until the projection lands.
    const journalEntries = page.getByRole("list", { name: /journal entries/i });
    await expect(async () => {
      await rail.getByRole("button", { name: "Choreo" }).click();
      await rail.getByRole("button", { name: "Journal" }).click();
      await expect(journalEntries.getByText("heads stay left")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // The card is a LESSON with the resolved figure-name link chip (T6 §3).
    await expect(page.getByText("LESSON", { exact: true })).toBeVisible();
    await expect(page.getByText(/↳ Natural Turn/)).toBeVisible();

    // Filters: lessons keeps it; practice hides it (frame 3.1 filter pills).
    const lessons = page.getByRole("button", { name: /^lessons$/i });
    await lessons.click();
    await expect(lessons).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("heads stay left")).toBeVisible();
    await page.getByRole("button", { name: /^practice$/i }).click();
    await expect(page.getByText("heads stay left")).toBeHidden();
  });
});
