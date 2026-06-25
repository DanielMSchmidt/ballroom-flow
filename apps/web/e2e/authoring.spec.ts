import { expect, test } from "@playwright/test";
import { gotoRoutine, seedAuth } from "./support/auth";

// ─────────────────────────────────────────────────────────────────────────
// Core authoring journey (PLAN §10.2 E2E: "full authoring (create → section →
// figure → attributes → role flip)").
// Covers: US-018 (open & view), US-025 (create), US-026 (sections),
//         US-027 (placements), US-028 (place attributes — hero), US-030 (role flip).
//
// @smoke — part of the CI PR smoke subset.
//
// SKIPPED until the M2/M3 screens + the deterministic E2E auth mode exist.
// Specs still COLLECT cleanly (playwright --list sees them).
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke core authoring journey", () => {
  test.skip(true, "M2/M3 screens + E2E auth mode not built yet (see TEST-MAP.md)");

  test("create a routine → add a section → add a figure → place attributes → flip role", async ({
    page,
  }) => {
    // Intent: the end-to-end hero loop from an empty account to a notated figure.
    // User scenario: a signed-in user builds a Foxtrot routine from scratch.
    // Steps/asserts:
    //   1. seedAuth + open the Choreo list. Click "New Choreo" → pick Foxtrot →
    //      the new routine opens in Assemble (US-025).
    //   2. Add a section "Intro"; it appears in order (US-026).
    //   3. Add a figure placement (Feather) to "Intro"; the card shows the name (US-027).
    //   4. Open the figure timeline; tap count 1 → choose footwork "HT"; the chip
    //      renders on count 1 (US-028 hero).
    //   5. Tap a step to flip the viewed role; the role indicator toggles (US-030).
    //   6. Reload → everything persisted (US-018 open & view).
    await seedAuth(page, "user_solo");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /ballroom flow/i })).toBeVisible();
  });

  test("a viewer sees the routine read-only (no edit affordances)", async ({ page }) => {
    // Intent: opening a routine as a viewer shows content but no edit controls.
    // User scenario: a viewer member opens a shared routine.
    // Steps/asserts: seedAuth as a viewer; open the shared routine; sections +
    //   placements render; NO add-section / add-figure / attribute-edit controls (US-018/021).
    await seedAuth(page, "user_viewer");
    await gotoRoutine(page, "rt_sample");
    await expect(page.getByRole("button", { name: /add section/i })).toHaveCount(0);
  });
});
