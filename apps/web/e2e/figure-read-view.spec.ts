import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Figure read view journey (PLAN §4.4, design `figMode`): tapping a figure on
// the READING programme opens the figure READ-ONLY — the notes surfaces are
// there (addable per role) but nothing is editable, even for an editor. The
// step editor is reached only explicitly: the pencil "Edit steps" toggle on
// the open detail, or the builder's placement card. Runs against the REAL
// worker (D1 + per-document DOs) via the #191 harness.
//
// @smoke — this journey is the feature's PR gate (delivery model, CLAUDE.md §6).
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke figure read view (reading lens opens read-only)", () => {
  test("reading-lens detail is read-only with comments; explicit Edit unlocks the editor", async ({
    page,
  }) => {
    const user = "user_readview";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Reader", identityColor: "#7a4de8" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // Create a routine with a CUSTOM figure ("Shadow Feather" has no catalog
    // match, so the mint opens its step editor — create-navigates, §4.3);
    // notate one step there, then close the editor.
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Choreo name").fill("E2E Read View");
    await page.getByRole("button", { name: "Foxtrot" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /create choreo/i })
      .click();

    const addSection = page.getByRole("button", { name: "Add section" });
    await expect(addSection).toBeVisible({ timeout: 15_000 });
    await addSection.click();
    await page.getByLabel("Section name").fill("Intro");
    await page.getByLabel("Section name").press("Enter");
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByRole("button", { name: /create my own figure/i }).click();
    await page.getByLabel("Figure name").fill("Shadow Feather");
    await page.getByLabel("Figure name").press("Enter");

    const detail = page.getByRole("dialog", { name: /steps · shadow feather/i });
    await expect(detail).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /^Add Step at count 1$/i }).click();
    await page.getByRole("button", { name: /^Edit Step at count 1$/i }).click();
    await page.getByRole("button", { name: /^Heel-Toe$/ }).click();
    await page.getByRole("button", { name: /^Done$/ }).click();
    await expect(page.getByLabel(/count 1 attributes/i).getByText("HT")).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");

    // READING lens → tapping the figure name opens the READ-ONLY figure view.
    await page.getByRole("button", { name: /reading view/i }).click();
    await page
      .getByTestId("reading-view")
      .getByRole("button", { name: "Shadow Feather", exact: true })
      .click();
    await expect(detail).toBeVisible({ timeout: 15_000 });

    // Read-only: the notated content shows, but there are NO cell add/edit
    // affordances and NO editing chrome — even though this user is the owner.
    await expect(detail.getByText("HT").first()).toBeVisible({ timeout: 15_000 });
    await expect(detail.getByRole("button", { name: /at count/i })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: /^undo$/i })).toHaveCount(0);

    // Comments live on the read view and are addable (commenter+): leave a note.
    const panel = page.getByRole("region", { name: /^annotations$/i });
    await panel.getByRole("textbox", { name: /^note$/i }).fill("lower in the knees here");
    await panel.getByRole("button", { name: /add note/i }).click();
    await expect(panel.getByText("lower in the knees here")).toBeVisible({ timeout: 15_000 });

    // The explicit pencil toggle flips the OPEN detail into the step editor…
    await detail.getByRole("button", { name: "Edit steps", exact: true }).click();
    await expect(detail.getByRole("button", { name: /^Edit Step at count 1$/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(detail.getByRole("button", { name: /^undo$/i })).toBeVisible();
    // …and edits actually land: quick-add a Step presence on count 2 (Builder
    // v3 ② — the cell's label flips from "Add" to "Edit" once it exists).
    await detail.getByRole("button", { name: /^Add Step at count 2$/i }).click();
    await expect(detail.getByRole("button", { name: /^Edit Step at count 2$/i })).toBeVisible({
      timeout: 15_000,
    });
  });
});
