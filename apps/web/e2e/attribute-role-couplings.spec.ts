import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Author-defined role couplings ship gate (docs/concepts/notation.md § Kinds /
// § Role lenses). An author creates a CUSTOM role-aware enum kind, declares a
// coupling map (leader value → follower value), and under the Both lens setting
// the leader to a coupled value fills the derived follower in one action — the
// capability `sway`/`direction` already had, now opened to custom kinds. A
// Follower-lens override then LOCKS that step under Both (the deliberate
// exception is never clobbered by the coupling). Runs against the REAL worker
// (D1 + per-document DOs) via the E2E harness.
//
// @smoke — part of the CI PR smoke subset.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke role couplings", () => {
  test("a custom coupling fills the follower under Both; a follower override locks the step", async ({
    page,
  }) => {
    const user = "user_couplings";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Coach", identityColor: "#c0563f" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // Routine → section → custom figure → its step editor (create-navigates).
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Choreo name").fill("E2E Couplings");
    await page.getByRole("button", { name: "Foxtrot" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /create choreo/i })
      .click();
    await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByLabel("Section name").fill("Walks");
    await page.getByLabel("Section name").press("Enter");
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByRole("button", { name: /create my own figure/i }).click();
    await page.getByLabel("Figure name").fill("Forward Walks");
    await page.getByLabel("Figure name").press("Enter");
    const sheet = page.getByRole("dialog", { name: /steps · forward walks/i });
    await expect(sheet).toBeVisible({ timeout: 15_000 });

    // 1. Create the coach's custom "Poise" kind: role-aware enum with a coupling
    //    row `forward → back` (upright/back copy through). The add-kind picker
    //    routes to the builder; the coupling grid shows once role-aware is on.
    await page.getByRole("button", { name: /add kind/i }).click();
    await page.getByRole("button", { name: /new attribute type/i }).click();
    await page.getByLabel(/^label/i).fill("Poise");
    // Commit each value as a chip (Enter fires the keydown handler; `.fill()`
    // would bypass it, leaving the coupling grid with no values to pick).
    const valueField = page.getByLabel(/add a value/i);
    await valueField.pressSequentially("forward");
    await valueField.press("Enter");
    await valueField.pressSequentially("upright");
    await valueField.press("Enter");
    await valueField.pressSequentially("back");
    await valueField.press("Enter");
    await page.getByRole("switch", { name: /leader.*follower/i }).click();
    await page.getByRole("button", { name: /add pairing/i }).click();
    await page.getByLabel(/pairing 1 leader value/i).selectOption("forward");
    await page.getByLabel(/pairing 1 follower value/i).selectOption("back");
    await page.getByRole("button", { name: /^create$/i }).click();

    // 2. Under BOTH, tap the Poise cell at count 1 and set Poise = forward. The
    //    coupling derives the follower's `back` in one action (bothWriteTargets).
    await sheet.getByRole("radio", { name: /^Both$/ }).click();
    await sheet.getByRole("button", { name: /^Add Poise at count 1$/i }).click();
    const overlay = page.getByRole("group", { name: /poise/i });
    await overlay.getByRole("button", { name: /^forward$/i }).click();
    await page.getByRole("button", { name: /^Done$/ }).click();

    // Both shows the leader's (verbatim) projection: forward.
    await expect(page.getByLabel(/count 1 attributes/i).getByText(/forward/i)).toBeVisible();

    // 3. The FOLLOWER lens shows the DERIVED value: back (the coupling fired).
    await sheet.getByRole("radio", { name: /^Follower$/ }).click();
    await expect(page.getByLabel(/count 1 attributes/i).getByText(/back/i)).toBeVisible();

    // 4. Override the follower to `upright` under its own lens — the coach's
    //    deliberate exception (follower upright against a forward-poised leader).
    await sheet.getByRole("button", { name: /^Edit Poise at count 1$/i }).click();
    const followerOverlay = page.getByRole("group", { name: /poise/i });
    await followerOverlay.getByRole("button", { name: /^back$/i }).click();
    await followerOverlay.getByRole("button", { name: /^upright$/i }).click();
    await page.getByRole("button", { name: /^Done$/ }).click();
    await expect(page.getByLabel(/count 1 attributes/i).getByText(/upright/i)).toBeVisible();

    // 5. Leader (forward) vs follower (upright) now diverge from the coupling's
    //    output (forward → back), so the Poise cell LOCKS under Both — the cell
    //    is no longer editable; tapping it explains instead of opening an editor.
    await sheet.getByRole("radio", { name: /^Both$/ }).click();
    const locked = sheet.getByRole("button", {
      name: /Poise at count 1 — leader and follower differ/i,
    });
    await expect(locked).toBeVisible();
    await expect(locked).toHaveAttribute("aria-disabled", "true");
  });
});
