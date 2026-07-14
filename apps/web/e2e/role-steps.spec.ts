import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// WEP-0005 ship gate — role-scoped step editing with a Both write mode.
// The edit-mode STEPS FOR lens is the WRITE SCOPE: Both writes the leader's
// direction verbatim + the mirrored follower's (forward↔back), leaves the
// follower's footwork empty (never derivable), and a single-role write is
// invisible under the other role's lens. Hand-diverged values lock under Both.
// Runs against the REAL worker (D1 + per-document DOs) via the E2E harness.
//
// @smoke — part of the CI PR smoke subset.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke WEP-0005 role-scoped steps", () => {
  test("Both mirrors the follower; single-role writes stay role-scoped; diverged cells lock", async ({
    page,
  }) => {
    const user = "user_roles";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Roles", identityColor: "#7744aa" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // Create a routine → section → custom figure; creating a new custom figure
    // opens its full-screen step editor immediately (create-navigates, §4.3).
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Choreo name").fill("E2E Roles");
    await page.getByRole("button", { name: "Foxtrot" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /create choreo/i })
      .click();
    await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByLabel("Section name").fill("Intro");
    await page.getByLabel("Section name").press("Enter");
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByRole("button", { name: /create my own figure/i }).click();
    await page.getByLabel("Figure name").fill("Three Step");
    await page.getByLabel("Figure name").press("Enter");
    const sheet = page.getByRole("dialog", { name: /steps · three step/i });
    await expect(sheet).toBeVisible({ timeout: 15_000 });

    // 1. Notate count 1 under BOTH: direction Forward + footwork Heel-Toe.
    await sheet.getByRole("radio", { name: /^Both$/ }).click();
    await sheet.getByRole("button", { name: /^Add Step at count 1$/i }).click();
    await sheet.getByRole("button", { name: /^Edit Step at count 1$/i }).click();
    await page.getByRole("button", { name: /^Forward$/ }).click();
    await page.getByRole("button", { name: /^Heel-Toe$/ }).click();
    await page.getByRole("button", { name: /^Done$/ }).click();

    // Under Both the grid shows the leader's (verbatim) projection.
    await expect(page.getByTestId("step-headline-1")).toHaveText(/forward/i);
    await expect(page.getByLabel(/count 1 attributes/i).getByText("HT")).toBeVisible();

    // 2. The FOLLOWER lens shows the mirrored direction and NO footwork —
    //    heel/toe work is never derived, it stays empty until authored.
    await sheet.getByRole("radio", { name: /^Follower$/ }).click();
    await expect(page.getByTestId("step-headline-1")).toHaveText(/back/i);
    await expect(page.getByLabel(/count 1 attributes/i).getByText("HT")).toHaveCount(0);

    // 3. Author the follower's own footwork under the Follower lens.
    await sheet.getByRole("button", { name: /^Edit Step at count 1$/i }).click();
    await page.getByRole("button", { name: /^Toe-Heel$/ }).click();
    await page.getByRole("button", { name: /^Done$/ }).click();
    await expect(page.getByLabel(/count 1 attributes/i).getByText("TH")).toBeVisible();

    // 4. The follower-only value is INVISIBLE under the Leader lens — the
    //    leader still dances Heel-Toe (the quick-add role:null leak is fixed).
    await sheet.getByRole("radio", { name: /^Leader$/ }).click();
    await expect(page.getByTestId("step-headline-1")).toHaveText(/forward/i);
    await expect(page.getByLabel(/count 1 attributes/i).getByText("HT")).toBeVisible();
    await expect(page.getByLabel(/count 1 attributes/i).getByText("TH")).toHaveCount(0);

    // 5. Footwork now genuinely diverges (leader HT / follower TH), so the
    //    Step cell LOCKS under Both — tapping explains instead of editing.
    await sheet.getByRole("radio", { name: /^Both$/ }).click();
    const locked = sheet.getByRole("button", {
      name: /Step at count 1 — leader and follower differ/i,
    });
    await expect(locked).toBeVisible();
    await expect(locked).toHaveAttribute("aria-disabled", "true");
    // aria-disabled makes Playwright's actionability check refuse a normal
    // click; a real tap still lands, so force it to assert the toast path.
    await locked.click({ force: true });
    await expect(page.getByRole("dialog", { name: /^count 1$/i })).toHaveCount(0);
    await expect(page.getByText(/switch to a single role to edit/i).first()).toBeVisible();

    // 6. Role-tagged attributes persist (figure doc, its own DO): after reload
    //    each lens still shows only its own chart.
    await page.reload();
    await page.getByRole("button", { name: /list view/i }).click();
    await page.getByRole("button", { name: /edit steps: Three Step/i }).click();
    const sheet2 = page.getByRole("dialog", { name: /steps · three step/i });
    await expect(sheet2).toBeVisible({ timeout: 15_000 });
    await sheet2.getByRole("radio", { name: /^Leader$/ }).click();
    await expect(page.getByTestId("step-headline-1")).toHaveText(/forward/i, { timeout: 15_000 });
    await expect(page.getByLabel(/count 1 attributes/i).getByText("HT")).toBeVisible();
    await sheet2.getByRole("radio", { name: /^Follower$/ }).click();
    await expect(page.getByTestId("step-headline-1")).toHaveText(/back/i);
    await expect(page.getByLabel(/count 1 attributes/i).getByText("TH")).toBeVisible();
  });
});
