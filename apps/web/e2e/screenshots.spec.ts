import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// @screenshots — NOT in @smoke. Drives the REAL app (via the #191 harness) to
// build the cited Bronze International Waltz amalgamation and capture the
// landing-page photos. Output PNGs are the committed marketing assets.
// Source routine: dancecentral.info International Waltz choreography.
// ─────────────────────────────────────────────────────────────────────────

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/marketing/screenshots",
);
const shot = (name: string) => path.join(OUT, name);

// Long Side then Short Side of the floor (the app's section model).
const LONG_SIDE = [
  "Natural Spin Turn",
  "Reverse Turn",
  "Double Reverse Spin",
  "Whisk",
  "Chassé from PP",
  "Hesitation Change",
];
const SHORT_SIDE = ["Reverse Turn", "Basic Weave", "Chassé from PP"];

test.describe("@screenshots landing imagery", () => {
  test("build a Waltz routine and capture the marketing screenshots", async ({ page }) => {
    // This test creates 2 sections + 9 figures — give it plenty of time.
    test.setTimeout(180_000);

    const user = "user_demo";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Ava Lindqvist", identityColor: "#b8336a" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // 1. Create-routine modal (Waltz).
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Routine name").fill("Bronze Waltz");
    // Waltz is the pre-selected chip in the New-choreo sheet.
    await expect(page.getByRole("dialog", { name: "New choreography" })).toBeVisible();
    await page.screenshot({ path: shot("create.png") });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /create choreo/i })
      .click();

    // Editor ready.
    await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({
      timeout: 15_000,
    });

    // 2. Two sections + their figures.
    //    Use .last() on "Add figure" so we always target the most recently added
    //    section (when Short Side exists, both sections have an "Add figure" button).
    for (const [section, figures] of [
      ["Long Side", LONG_SIDE],
      ["Short Side", SHORT_SIDE],
    ] as const) {
      await page.getByRole("button", { name: "Add section" }).click();
      await page.getByLabel("Section name").fill(section);
      await page.getByLabel("Section name").press("Enter");
      await expect(page.getByRole("heading", { name: section })).toBeVisible({ timeout: 15_000 });
      for (const figure of figures) {
        await page.getByRole("button", { name: "Add figure" }).last().click();
        await page.getByLabel("Figure name").fill(figure);
        await page.getByLabel("Figure name").press("Enter");
        await expect(page.getByText(figure).first()).toBeVisible({ timeout: 15_000 });
      }
    }
    // Scroll to top and wait for section-added toasts to clear before screenshots.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByText("Added Long Side")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Added Short Side")).not.toBeVisible({ timeout: 10_000 });

    // Hero: ASSEMBLE editor overview — "Your whole routine, figure by figure."
    // Captured at default viewport (punchy top-of-routine shot, not fullPage).
    await expect(page.getByRole("heading", { name: "Long Side" })).toBeVisible();
    await expect(page.getByText("Natural Spin Turn").first()).toBeVisible();
    await page.screenshot({ path: shot("hero.png") });

    // Full-page assemble view showing both Long + Short sections.
    await page.screenshot({ path: shot("sections.png"), fullPage: true });

    // 3. Notate the Natural Spin Turn across technique dimensions.
    //    "Edit steps: …" matches the aria-label on PlacementCard (canEdit → "Edit").
    await page
      .getByRole("button", { name: /edit steps: Natural Spin Turn/i })
      .first()
      .click();
    await page.getByRole("button", { name: /beat 1/i }).click();
    await page.getByRole("button", { name: /^forward$/ }).click(); // direction headline
    await page.getByRole("button", { name: /^ball$/ }).click(); // footwork slot
    // Reveal technique kinds (rise & fall, sway, turn, body actions, position).
    await page.getByRole("button", { name: /more attributes/i }).click();
    // Set a Rise & Fall value so a technique chip appears in the notate.png shot.
    // "commence" is a valid rise value for Waltz (waltz is in RISE_DANCES).
    await page.getByRole("button", { name: /^commence$/ }).click();
    await expect(page.getByTestId("step-headline-1")).toHaveText(/forward/i);
    await expect(page.getByLabel(/count 1 attributes/i).getByText("ball")).toBeVisible();
    await page.screenshot({ path: shot("notate.png") });

    // 4. Lanes cross-step grid — the "Lanes" button lives INSIDE the notation
    //    sheet (Assemble.tsx), so click it while the sheet is still open.
    //    The grid renders below the fold of the sheet's scroll area; scroll it
    //    into the modal's visible region before capturing.
    await page.getByRole("button", { name: "Lanes" }).click();
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("grid").scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("lanes.png"), fullPage: true });

    // Close the notation sheet before navigating to reading view.
    await page.keyboard.press("Escape");

    // 5. Reading view (read-only share surface).
    await page.getByRole("button", { name: /reading view/i }).click();
    await expect(page.getByTestId("reading-view")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: shot("reading.png"), fullPage: true });
  });
});
