import { test } from "@playwright/test";
import { gotoRoutine, seedAuth } from "./support/auth";
import { closeUsers, expectConverged, openTwoUsers } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// Two live clients converge on a routine (PLAN §10.2 E2E: "two live contexts
// converge on a routine"). Covers US-015 (live WS sync) + US-052 (cross-browser).
//
// @smoke — the CI smoke subset includes one convergence journey.
// Multi-user: two REAL browser contexts (coach + student) editing the SAME doc.
// Convergence asserted on observable DOM state via expectConverged (NO sleeps).
//
// SKIPPED until live WS sync (M2) + screens + E2E auth exist.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke two clients converge on a routine", () => {
  test.skip(true, "live WS sync (M2) + screens + E2E auth not built yet (see TEST-MAP.md)");

  test("an edit by user A appears live for user B and vice versa", async ({ browser }) => {
    // Intent: two co-editing members see each other's edits without reload (live sync).
    // Multi-user scenario: coach and student both open routine rt_sample as editors.
    // Steps/asserts:
    //   1. openTwoUsers(coach, student); both seedAuth + gotoRoutine(rt_sample).
    //   2. Coach adds a section "Coda".
    //   3. expectConverged([coachPage, studentPage], section list, "Coda") — both show it.
    //   4. Student renames a placement; expectConverged shows the rename on BOTH.
    // Covers US-015 AC-1 (two clients converge) + US-052 (cross-browser via the 3 projects).
    const [coach, student] = await openTwoUsers(browser, "user_coach", "user_student");
    await seedAuth(coach.page, coach.userId);
    await seedAuth(student.page, student.userId);
    await Promise.all([
      gotoRoutine(coach.page, "rt_sample"),
      gotoRoutine(student.page, "rt_sample"),
    ]);
    await coach.page.getByRole("button", { name: /add section/i }).click();
    // The coach types the new section name; both clients must converge on it.
    await coach.page.getByRole("textbox", { name: /section name/i }).fill("Coda");
    await coach.page.getByRole("button", { name: /save section/i }).click();
    await expectConverged([coach.page, student.page], "[data-testid='section-list']", "Coda");
    await closeUsers(coach, student);
  });

  test("a duplicate change over the socket does not duplicate the edit", async ({ browser }) => {
    // Intent: idempotent change delivery — no double-applied edits on reconnect.
    // Multi-user scenario: student edits; the same change is redelivered (e.g. reconnect).
    // Steps/asserts: student adds one placement; force a reconnect (offline→online);
    //   the placement count on the coach's page is exactly 1 more (not 2) — convergence
    //   with idempotence (US-015 AC-3).
    const [coach, student] = await openTwoUsers(browser, "user_coach", "user_student");
    await seedAuth(coach.page, coach.userId);
    await seedAuth(student.page, student.userId);
    await Promise.all([
      gotoRoutine(coach.page, "rt_sample"),
      gotoRoutine(student.page, "rt_sample"),
    ]);
    await closeUsers(coach, student);
  });
});
