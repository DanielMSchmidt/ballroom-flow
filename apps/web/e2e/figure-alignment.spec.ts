import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Catalog figure-level alignment (per-figure entry/exit). A charted library
// figure now seeds its "where it started / where it ended" alignment from the
// real WDSF Technique Book chart, so adding it from the library shows the
// alignment WITHOUT the user re-entering it. The Waltz Natural Turn enters
// facing Diagonal Wall and exits facing Diagonal Centre. (The Closed Changes
// carry NO alignment — the book charts theirs as "depending on the previous
// figure".)
//
// Runs against the real worker via the #191 harness, so it exercises the whole
// chain: catalog seed → POST /api/figures → seedDoc → FigureDoc → Assemble chips.
//
// @smoke — the catalog-alignment slice is done only when this journey is green.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke catalog figure alignment", () => {
  test("a library Natural Turn carries its charted entry/exit alignment", async ({ page }) => {
    const user = "user_align";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Al", identityColor: "#2c8a85" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // 1. Create a Waltz routine.
    await page.getByRole("button", { name: "Choreo", exact: true }).click();
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Choreo name").fill("Alignment Waltz");
    await page.getByRole("button", { name: "Waltz", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /create choreo/i })
      .click();

    // 2. Add a section.
    await page.getByRole("button", { name: "Add section" }).click({ timeout: 15_000 });
    await page.getByLabel("Section name").fill("Basics");
    await page.getByLabel("Section name").press("Enter");
    await expect(page.getByRole("heading", { name: "Basics" })).toBeVisible({ timeout: 15_000 });

    // 3. Add the Natural Turn FROM the library (carries the catalog chart).
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByRole("button", { name: /^natural turn$/i }).click();
    await expect(page.getByText("Natural Turn").first()).toBeVisible({ timeout: 15_000 });

    // 4. The charted figure-level alignment is seeded with the figure — per the
    //    WDSF book the Natural Turn enters facing Diagonal Wall and, after its
    //    3/4 turn, exits facing Diagonal Centre — with no manual entry.
    await expect(page.getByText(/entry facing diag wall/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/exit facing diag centre/i)).toBeVisible({ timeout: 15_000 });

    // 5. …and the full per-step footwork from the catalog chart, with no manual
    //    notation. The reading view merges each step's direction + footwork into one
    //    "Step" chip (frame 1.6). LEADER lens (the default): RF fwd Heel-Flat (the
    //    WDSF drive step) → "fwd·HF", LF side Toe → "side·T", RF closes Toe-Heel →
    //    "close·TH".
    await page.getByRole("button", { name: /reading view/i }).click();
    const reading = page.getByTestId("reading-view");
    await expect(reading.getByText("fwd·HF").first()).toBeVisible({ timeout: 15_000 });
    await expect(reading.getByText("side·T").first()).toBeVisible();
    await expect(reading.getByText("close·TH").first()).toBeVisible();

    // 5b. The follower dances her OWN footwork (role-aware, mirrored): flip the
    //     lens — the compact L·F toggle in the screen header (design 1.23) —
    //     and her count-1 step reads LF back Toe-Heel → "back·TH".
    await page.getByRole("radio", { name: "Follower" }).click();
    await expect(reading.getByText("back·TH").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("radio", { name: "Leader" }).click();

    // 6. Type-chips column filter (design 1.23): hiding Rise tucks the column
    //    away across the programme, the figure grows a "+1 hidden" peek pill,
    //    and peeking brings the column back for THAT figure only (chips stay
    //    put). Hiding never touches data — showing it again restores the column.
    const riseHeader = reading.getByRole("button", { name: "About Rise", exact: true });
    await page.getByRole("button", { name: "Hide the Rise column" }).click();
    await expect(riseHeader).toHaveCount(0);
    await reading.getByRole("button", { name: "Peek at 1 hidden column" }).click();
    await expect(riseHeader).toBeVisible();
    await reading.getByRole("button", { name: "Hide the tucked-away columns again" }).click();
    await expect(riseHeader).toHaveCount(0);
    await page.getByRole("button", { name: "Show the Rise column" }).click();
    await expect(riseHeader).toBeVisible();

    await page.screenshot({ path: "test-results/natural-turn-alignment.png", fullPage: true });
  });
});
