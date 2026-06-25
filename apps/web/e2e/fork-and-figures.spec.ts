import { expect, test } from "@playwright/test";
import { gotoRoutine, seedAuth } from "./support/auth";
import { closeUsers, expectAbsent, expectConverged, openTwoUsers } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// Fork + inheritance journeys (PLAN §10.2 E2E). Covers:
//   US-037 — choreo fork → frozen/independent (origin edit does NOT appear);
//   US-034 — edit your own shared figure → flows into a SECOND routine;
//   US-035 — auto-variant: edit a global/non-owned figure → variant created,
//            original untouched, "copied as your variant" toast.
//
// @smoke includes one fork/copy-on-write journey (PLAN §10.3).
// SKIPPED until M4 fork UX + screens + E2E auth exist.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke choreo fork is frozen / independent", () => {
  test.skip(true, "M4 fork UX + screens + E2E auth not built yet (see TEST-MAP.md)");

  test("forking a routine yields an independent copy; an origin edit does NOT appear in the fork", async ({
    browser,
  }) => {
    // Intent: a choreo fork is frozen at fork time — origin changes never flow in.
    // Multi-user scenario: student forks the coach's routine; coach then edits the ORIGIN.
    // Steps/asserts:
    //   1. Student opens rt_sample and clicks "Make it your own" → an owned fork opens
    //      with a "forked from" lineage label (US-037 AC-1/AC-3).
    //   2. Coach (separate context) adds a section "OriginOnly" to the ORIGIN rt_sample.
    //   3. The coach's origin shows "OriginOnly" (converged on the origin doc),
    //      but the student's FORK never shows it — expectAbsent (US-037 AC-2 frozen).
    const [coach, student] = await openTwoUsers(browser, "user_coach", "user_student");
    await seedAuth(coach.page, coach.userId);
    await seedAuth(student.page, student.userId);
    await gotoRoutine(student.page, "rt_sample");
    await student.page.getByRole("button", { name: /make it your own|fork/i }).click();
    await expect(student.page.getByText(/forked from/i)).toBeVisible();
    // Coach edits the ORIGIN; it must not bleed into the student's frozen fork.
    await gotoRoutine(coach.page, "rt_sample");
    await coach.page.getByRole("button", { name: /add section/i }).click();
    await coach.page.getByRole("textbox", { name: /section name/i }).fill("OriginOnly");
    await coach.page.getByRole("button", { name: /save section/i }).click();
    await expectAbsent(student.page, "text=OriginOnly");
    await closeUsers(coach, student);
  });
});

test.describe("figure auto-update + auto-variant (copy-on-write)", () => {
  test.skip(true, "M4 figure library + COW + screens + E2E auth not built yet");

  test("editing your OWN figure flows into every routine that references it", async ({ page }) => {
    // Intent: refine a figure once → the change appears wherever it's used (US-034).
    // User scenario: a user owns a figure referenced by routine A and routine B.
    // Steps/asserts: open the owned figure from A's timeline; add a sway on count 2;
    //   open routine B → the same figure there now shows the sway (auto-update).
    await seedAuth(page, "user_owner");
    await gotoRoutine(page, "rt_A_owned");
    await expect(page).toHaveURL(/rt_A_owned/);
  });

  test("editing a GLOBAL figure auto-creates your variant with a toast; original untouched", async ({
    page,
  }) => {
    // Intent: editing a non-owned (global) figure silently creates an account variant,
    //   re-points the placement, shows "copied as your variant", original unchanged (US-035).
    // User scenario: a user edits a global Feather inside their routine.
    // Steps/asserts:
    //   1. Open the global Feather in the routine timeline; change count-1 footwork.
    //   2. A "copied as your variant" toast appears (US-035 AC-2); no blocking prompt (AC-4).
    //   3. The placement now shows a variant lineage badge (re-pointed, AC-1).
    //   4. Opening the global Feather elsewhere still shows the ORIGINAL value (AC-3).
    await seedAuth(page, "user_editor");
    await gotoRoutine(page, "rt_with_global_feather");
    await expect(page).toHaveURL(/rt_with_global_feather/);
  });
});

test.describe("cross-dance figureType notes + co-member visibility (option 2)", () => {
  test.skip(true, "M6 annotations + cross-account read + screens + E2E auth not built yet");

  test("an all-dances family note surfaces on a Feather in BOTH a Waltz and a Foxtrot routine", async ({
    page,
  }) => {
    // Intent: a figureType note scoped "all dances" surfaces on every matching figure
    //   across dances; a this-dance note only in that dance (US-040).
    // User scenario: the user annotates "every Feather: keep the head left" (all dances).
    // Steps/asserts:
    //   1. From a figure family, add a family note scoped "all dances".
    //   2. Open a Foxtrot routine with a Feather → the note shows.
    //   3. Open a Waltz routine with a Feather → the note shows too (all-dances).
    //   4. A this-dance (Foxtrot) note does NOT show in the Waltz routine.
    await seedAuth(page, "user_owner");
    await gotoRoutine(page, "rt_foxtrot_feather");
    await expect(page).toHaveURL(/rt_foxtrot_feather/);
  });

  test("a co-member sees a coach's family note on a shared routine; a non-member sees none", async ({
    browser,
  }) => {
    // Intent: option-2 visibility — the coach's family note surfaces for a CO-MEMBER on a
    //   shared routine's matching figure, but NOT for a non-member (US-041).
    // Multi-user scenario: coach authors "every Feather: head left"; student is a co-member
    //   of the shared Feather routine; a stranger is not.
    // Steps/asserts:
    //   1. Coach adds an all-dances Feather family note (in their account doc).
    //   2. Student opens the SHARED routine rt_sample → sees the coach's note on the Feather.
    //   3. Stranger opens (or is denied) rt_sample → sees NONE of the coach's family notes.
    const [student, stranger] = await openTwoUsers(browser, "user_student", "user_stranger");
    await seedAuth(student.page, student.userId);
    await seedAuth(stranger.page, stranger.userId);
    await gotoRoutine(student.page, "rt_sample");
    await expectConverged([student.page], "[data-testid='figure-notes']", /head left/i);
    await expectAbsent(stranger.page, "text=head left");
    await closeUsers(student, stranger);
  });
});
