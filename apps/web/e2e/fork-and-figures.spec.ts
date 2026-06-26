import { expect, type Page, test } from "@playwright/test";
import { gotoRoutine, seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";
import { closeUsers, expectAbsent, expectConverged, openTwoUsers } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// Fork + inheritance journeys (PLAN §10.2 E2E). Covers:
//   US-037 — choreo fork → frozen/independent (origin edit does NOT appear);
//   US-034 — edit your own shared figure → flows into a SECOND routine;
//   US-035 — auto-variant: edit a global/non-owned figure → variant created,
//            original untouched, "copied as your variant" toast.
//
// @smoke includes one fork/copy-on-write journey (PLAN §10.3). The choreo-fork
// journey (US-037) is LIVE; the figure auto-update / COW (US-034/035) and
// cross-dance figureType-note (US-040/041) journeys stay skipped until those
// FE-3 figure-library / FE-6 annotation slices land.
// ─────────────────────────────────────────────────────────────────────────

/** Coach creates a routine via the UI; returns its docRef (from the URL). */
async function createRoutineAsCoach(page: Page, title: string): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: /new choreo/i }).click();
  await page.getByLabel("Routine name").fill(title);
  await page.getByLabel("Dance").selectOption("waltz");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({ timeout: 15_000 });
  const docRef = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(docRef, "expected a created routine id in the URL").toBeTruthy();
  return docRef;
}

/** Add a section by name on a page that already shows the editor surface. */
async function addSection(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByLabel("Section name").fill(name);
  await page.getByLabel("Section name").press("Enter");
}

test.describe("@smoke choreo fork is frozen / independent", () => {
  test("forking a routine yields an independent, owned copy; an origin edit does NOT appear in the fork (US-037)", async ({
    browser,
  }) => {
    // Intent: a choreo fork is an OWNED, frozen copy — it carries the origin's
    //   content at fork time but later origin changes never flow in.
    // Multi-user scenario: the coach owns a routine and shares VIEW with the
    //   student; the student forks it, then the coach edits the ORIGIN.
    const [coach, student] = await openTwoUsers(browser, "user_coach", "user_student");
    await resetDb(coach.page);
    await seedDb(coach.page, {
      users: [
        { id: "user_coach", displayName: "Coach", identityColor: "#111111" },
        { id: "user_student", displayName: "Student", identityColor: "#222222" },
      ],
    });
    await seedAuth(coach.page, "user_coach");
    await seedAuth(student.page, "user_student");

    // Coach creates a routine with a section, then shares VIEW with the student.
    const docRef = await createRoutineAsCoach(coach.page, "Forkable Waltz");
    await addSection(coach.page, "OriginSec");
    await expect(coach.page.getByRole("heading", { name: "OriginSec" })).toBeVisible({
      timeout: 15_000,
    });
    await seedDb(coach.page, { memberships: [{ docRef, userId: "user_student", role: "viewer" }] });

    // Student opens it (read-only — no Add section) and forks it.
    await student.page.goto(`/routines/${docRef}`);
    await expect(student.page.getByRole("heading", { name: "OriginSec" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(student.page.getByRole("button", { name: "Add section" })).toHaveCount(0);
    await student.page.getByRole("button", { name: /make a copy/i }).click();

    // The fork opens: wait on the lineage badge (unique to a fork) so we don't
    // read the URL before the async fork+navigate completes. It opens at a
    // DIFFERENT id, shows the cloned section, and is OWNED (student can edit).
    await expect(student.page.getByText(/forked copy/i)).toBeVisible({ timeout: 15_000 });
    const forkRef = new URL(student.page.url()).pathname.split("/").pop();
    expect(forkRef).not.toBe(docRef);
    await expect(student.page.getByRole("heading", { name: "OriginSec" })).toBeVisible();
    await expect(student.page.getByRole("button", { name: "Add section" })).toBeVisible();

    // Coach edits the ORIGIN; it must NOT bleed into the student's frozen fork.
    await addSection(coach.page, "OriginOnly");
    await expect(coach.page.getByRole("heading", { name: "OriginOnly" })).toBeVisible({
      timeout: 15_000,
    });
    await expectAbsent(student.page, "[data-testid='section-list'] >> text=OriginOnly");
    // ...and the fork still shows what it cloned (it isn't blank/broken).
    await expect(student.page.getByRole("heading", { name: "OriginSec" })).toBeVisible();
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
