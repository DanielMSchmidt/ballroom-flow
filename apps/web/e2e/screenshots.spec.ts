import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
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

/** Prepare the empty-state create shot for a STABLE capture. Waiting for the
 *  tour <video> to attach proves the routines query has settled (so we shoot the
 *  real empty state, not the loading spinner). We then HIDE that video: its
 *  poster is a GPU-scaled bitmap that jitters a few sub-pixels run-to-run, which
 *  shows up as noise in the CI screenshot pixel-diff (and would churn the committed
 *  landing asset) — and it isn't the subject of the "create" shot anyway. */
async function settleEmptyStateForCreateShot(page: Page): Promise<void> {
  const video = page.locator("video").first();
  await video.waitFor({ state: "attached", timeout: 15_000 });
  await video.evaluate((v) => {
    v.style.display = "none";
  });
  // The sample/template rows arrive from /api/templates, whose FIRST call after
  // resetDb also lazily seeds the sample — a separate, slower query than the
  // routines fetch the video-attach wait proves. Without this wait the shot's
  // background depends on which side of that race the run lands (the baseline
  // workflow and the PR job landed on different sides — a standing false diff).
  await expect(page.getByRole("button", { name: /start from template/i })).toBeVisible({
    timeout: 15_000,
  });
}

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
    await page.getByLabel("Choreo name").fill("Bronze Waltz");
    // Waltz is the pre-selected chip in the New-choreo sheet.
    await expect(page.getByRole("dialog", { name: "New choreography" })).toBeVisible();
    // Settle the empty state + drop the jitter-prone tour video before capturing.
    await settleEmptyStateForCreateShot(page);
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
        // Tap the CATALOG preset (typing the name would mint an un-charted
        // custom figure and open its editor — create-navigates, §4.3).
        await page.getByRole("button", { name: figure, exact: true }).click();
        // Portion picker (Builder v3 ③): whole figure pre-selected — confirm.
        await page.getByRole("button", { name: /add to choreo/i }).click();
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

    // 2b. Add-figure picker (diff-only shots, not on the landing page): the
    //     searchable library with the ALWAYS-PRESENT "Create my own figure"
    //     row below it, then the compose view (name + length) the row swaps
    //     the selection UI for. Escape closes the sheet without minting a
    //     figure, so the built routine is untouched.
    await page.getByRole("button", { name: "Add figure" }).last().click();
    const createRow = page.getByRole("button", { name: /create my own figure/i });
    await expect(createRow).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: shot("addfigure.png") });
    await createRow.click();
    await expect(page.getByLabel("Figure name")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: shot("composefigure.png") });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /add a figure/i })).not.toBeVisible();

    // 3. Notate the Natural Spin Turn across technique dimensions.
    //    "Edit steps: …" matches the aria-label on PlacementCard (canEdit → "Edit").
    await page
      .getByRole("button", { name: /edit steps: Natural Spin Turn/i })
      .first()
      .click();
    // The full-screen bars-driven grid opens (frame 1.11): every timing × every
    // attribute column. The Natural Spin Turn is a charted catalog figure, so
    // count 1's recap already reads its leader headline — a good hero shot of the
    // notation surface without opening a cell overlay.
    await expect(page.getByRole("table", { name: /step grid/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("step-headline-1")).toHaveText(/forward/i);
    await page.screenshot({ path: shot("notate.png") });

    // 4. Lanes cross-step grid — the "Lanes" button lives INSIDE the notation
    //    sheet (Assemble.tsx), so click it while the sheet is still open.
    //    Element-level screenshot crops tightly to the grid so the beats + chips
    //    dominate the frame rather than being buried under annotation chrome.
    await page.getByRole("button", { name: "Lanes" }).click();
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("grid").screenshot({ path: shot("lanes.png") });

    // Close the notation sheet before navigating to reading view.
    await page.keyboard.press("Escape");

    // 5. Reading view (read-only share surface).
    await page.getByRole("button", { name: /reading view/i }).click();
    await expect(page.getByTestId("reading-view")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: shot("reading.png"), fullPage: true });

    // 6. Figure READ view (docs/concepts/notation.md § The figure editor,
    //    design figMode): tapping a figure on the
    //    reading programme opens it read-only — the step grid as the content,
    //    the notes surfaces beneath, and the pencil "Edit steps" toggle in the
    //    header as the only route into editing.
    await page
      .getByTestId("reading-view")
      .getByRole("button", { name: "Natural Spin Turn", exact: true })
      .first()
      .click();
    await expect(page.getByRole("table", { name: /step grid/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Edit steps", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: /^annotations$/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({ path: shot("figure.png") });
  });
});
