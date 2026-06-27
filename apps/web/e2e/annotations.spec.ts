import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// FE-6 annotations journey (PLAN §4.6 E2E). Runs against the REAL worker (D1 +
// per-document Durable Objects + the fail-closed auth/sync boundary) via the
// #191 harness — no live Clerk, a real test JWT, the real permission boundary.
// Covers US-039 (create a note on a figure + reply thread) and US-042 (filter
// by kind). The note lives in the routine doc, so it rides the existing sync.
//
// @smoke — part of the CI PR smoke subset.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke annotations journey", () => {
  test("create a routine → notate a figure → add a lesson + reply → filter", async ({ page }) => {
    const user = "user_anno";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Annotator", identityColor: "#1f8a5b" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // Create a routine and add a figure to notate (US-025/026/027).
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Routine name").fill("E2E Annotations");
    await page.getByLabel("Dance").selectOption("foxtrot");
    await page.getByRole("button", { name: "Create" }).click();

    const addSection = page.getByRole("button", { name: "Add section" });
    await expect(addSection).toBeVisible({ timeout: 15_000 });
    await addSection.click();
    await page.getByLabel("Section name").fill("Intro");
    await page.getByLabel("Section name").press("Enter");
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByLabel("Figure name").fill("Feather Step");
    await page.getByLabel("Figure name").press("Enter");
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });

    // Open the figure's step sheet — the annotation panel lives here.
    await page.getByRole("button", { name: /edit steps: Feather Step/i }).click();

    // US-039: add a LESSON note on this figure; it renders in the thread.
    await page.getByLabel("Kind").selectOption("lesson");
    await page.getByRole("textbox", { name: /note/i }).fill("keep the head left");
    await page.getByRole("button", { name: /add note/i }).click();
    await expect(page.getByText("keep the head left")).toBeVisible({ timeout: 15_000 });

    // US-039: reply forms an ordered thread.
    await page.getByRole("textbox", { name: /reply/i }).fill("on every Feather");
    await page.getByRole("button", { name: /post reply/i }).click();
    await expect(page.getByText("on every Feather")).toBeVisible({ timeout: 15_000 });

    // US-042: the "lessons" filter is engaged (aria-pressed); the lesson stays.
    const lessons = page.getByRole("button", { name: /^lessons$/i });
    await lessons.click();
    await expect(lessons).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("keep the head left")).toBeVisible();
  });
});
