import { expect, test } from "@playwright/test";
import { gotoRoutine, seedAuth } from "./support/auth";
import { closeUsers, expectConverged, openTwoUsers } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// Per-user undo across two clients (PLAN §10.2 E2E: "per-user undo across two
// clients"). Covers US-038 (undo reverts only YOUR change; the other client's
// concurrent edit survives; redo).
// SKIPPED until M5 undo UX + live sync + screens + E2E auth exist.
// ─────────────────────────────────────────────────────────────────────────

test.describe("per-user undo across two clients", () => {
  test.skip(true, "M5 undo UX + live sync + screens + E2E auth not built yet (see TEST-MAP.md)");

  test("A's undo reverts only A's last change; B's concurrent edit survives; redo restores", async ({
    browser,
  }) => {
    // Intent: history-based per-user undo merges correctly with a concurrent remote edit.
    // Multi-user scenario: A and B both edit the same routine; A undoes A's last change.
    // Steps/asserts:
    //   1. A adds section "FromA"; B adds section "FromB"; both converge (both see both).
    //   2. A clicks Undo → an "Undone" toast (US-038 AC-1); "FromA" disappears on BOTH;
    //      "FromB" REMAINS on both (US-038 AC-2 — B's edit survives).
    //   3. A clicks Redo → "FromA" reappears on both (US-038 AC-4).
    const [a, b] = await openTwoUsers(browser, "user_a", "user_b");
    await seedAuth(a.page, a.userId);
    await seedAuth(b.page, b.userId);
    await Promise.all([gotoRoutine(a.page, "rt_shared_ab"), gotoRoutine(b.page, "rt_shared_ab")]);
    // (A adds FromA, B adds FromB — omitted setup steps mirror authoring.spec.ts.)
    await a.page.getByRole("button", { name: /^undo$/i }).click();
    await expect(a.page.getByText(/undone/i)).toBeVisible();
    await expectConverged([a.page, b.page], "[data-testid='section-list']", "FromB");
    await closeUsers(a, b);
  });
});
