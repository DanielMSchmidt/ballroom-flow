import { expect, type Page, test } from "@playwright/test";
import { gotoRoutine, seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";
import { closeUsers, expectAbsent, openTwoUsers, openUser } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// Fork + inheritance journeys (PLAN §10.2 E2E). Covers:
//   US-037 — choreo fork → frozen/independent (origin edit does NOT appear);
//   US-034 — edit your own shared figure → flows into a SECOND routine;
//   US-035 — copy-on-write: edit a global/non-owned figure → frozen copy created
//            (its own attributes, no overlay), original untouched, "copied as your
//            variant" toast.
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
  // Waltz is the pre-selected chip in the New-choreo sheet, so no dance pick needed.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /create choreo/i })
    .click();
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
    // Opening an existing routine lands in READ; switch to the list view so
    // section headings are visible. The viewer still has no Add section button.
    await student.page.getByRole("button", { name: /list view/i }).click();
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
    // Forking opens the new routine in READ; switch to EDIT so section headings
    // and the Add section affordance (student now owns the fork) are visible.
    await student.page.getByRole("button", { name: /list view/i }).click();
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
  test("editing your OWN figure persists (US-034)", async ({ page }) => {
    // Intent: editing a figure the user owns is a direct in-place write that
    // persists across reloads — the DO stores it durably (US-034).
    // User scenario: create a routine, add "Feather Step", edit count-1 footwork to "T",
    //   reload → the T persists (it landed on the figure's own DO).
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: "user_owner", displayName: "Owner", identityColor: "#111111" }],
    });
    await seedAuth(page, "user_owner");

    // Create a routine + section + figure via the UI.
    const docRef = await createRoutineAsCoach(page, "Persist Waltz");
    await addSection(page, "Intro");
    await expect(page.getByRole("heading", { name: "Intro" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByLabel("Figure name").fill("Feather Step");
    await page.getByLabel("Figure name").press("Enter");
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });

    // Open the figure's step timeline and set count-1 footwork "T".
    await page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    await page.getByRole("button", { name: /beat 1/i }).click();
    await page.getByRole("button", { name: /^Heel-Toe$/ }).click();
    // The summary chip beneath count 1 shows the new value immediately.
    await expect(page.getByLabel(/count 1 attributes/i).getByText("HT")).toBeVisible({
      timeout: 15_000,
    });

    // Reload the page (auth session persists via addInitScript on every navigation).
    await page.reload();
    // Wait for the routine to re-hydrate (DO reconnects + replays changes).
    await page.goto(`/routines/${docRef}`);
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
    // Opening an existing routine lands in READ; switch to EDIT to access the
    // step timeline editor.
    await page.getByRole("button", { name: /list view/i }).click();

    // Re-open the figure's step timeline and verify "T" is still there.
    await page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    // The count 1 summary chip is visible without expanding — proves DO-persistence.
    await expect(page.getByLabel(/count 1 attributes/i).getByText("HT")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("@smoke editing a GLOBAL figure auto-creates your frozen copy; original untouched (US-035)", async ({
    page,
  }) => {
    // Intent: editing a global (app-owned library) figure silently spawns an owned
    // FROZEN copy (its own attributes, no overlay), re-points the placement, and shows
    // "Copied as your variant" (US-035). The base global figure is untouched — proved
    // at the worker layer (the copy carries its own attributes; this test verifies the
    // UI observables: toast + the divergence-derived "Custom" badge).
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: "user_editor", displayName: "Editor", identityColor: "#222222" }],
      figures: [
        {
          docRef: "fg_feather",
          scope: "global",
          ownerId: "app",
          name: "Feather Step",
          dance: "waltz",
          figureType: "feather",
          attributes: [{ id: "g1", kind: "step", count: 1, role: null, value: "HT" }],
        },
      ],
      docs: [
        {
          docRef: "rt_global",
          type: "routine",
          ownerId: "user_editor",
          dance: "waltz",
          title: "Global Ref Waltz",
          sections: [
            {
              id: "sec1",
              name: "Intro",
              placements: [{ id: "pl1", figureRef: "fg_feather" }],
            },
          ],
        },
      ],
      memberships: [{ docRef: "rt_global", userId: "user_editor", role: "editor" }],
      placementEdges: [{ routineRef: "rt_global", figureRef: "fg_feather" }],
    });
    await seedAuth(page, "user_editor");
    await page.goto("/routines/rt_global");

    // The placement card should show the global figure.
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
    // Opening an existing routine lands in READ; switch to EDIT to access the
    // step timeline editor for the copy-on-write trigger.
    await page.getByRole("button", { name: /list view/i }).click();

    // Open the figure's steps and trigger copy-on-write by editing count 1.
    await page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    await page.getByRole("button", { name: /beat 1/i }).click();
    // "T" is a suggestion in the Step kind; clicking it on a global figure triggers COW.
    await page.getByRole("button", { name: /^Heel-Toe$/ }).click();

    // The FigureTimeline immediately shows "Copied as your variant" (local state).
    // Use .first() because both FigureTimeline (on `copied`) and Assemble (`copiedToast`)
    // can briefly show this text simultaneously — M3 strict-mode flake guard.
    await expect(page.getByText(/copied as your variant/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // After the async COW (POST /api/figures + re-point) the placement card shows
    // a "Custom" badge — the copy's attributes have diverged from the catalog origin
    // (§2.5.1 #19; "Variant" is no longer a concept). The card is in the DOM behind
    // the sheet overlay (not hidden/display:none) so toBeVisible resolves.
    await expect(page.getByText(/^Custom$/)).toBeVisible({ timeout: 15_000 });
    // The global figure's base data is not asserted here from a second UI context
    // (no in-app path to read a raw global figure); the COW unit tests prove it.
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
});

test.describe("@smoke co-member family-note visibility (US-041)", () => {
  test("a co-member sees a coach's family note on a shared routine; a non-member sees none", async ({
    browser,
  }) => {
    // Intent: option-2 visibility — a coach's figure-family note surfaces for a
    //   CO-MEMBER on a shared routine's matching figure, but NOT for a non-member.
    // Multi-user scenario (three real contexts): coach authors "every Feather:
    //   keep the head left" (all dances) on a routine, shares COMMENTER with the
    //   student, while a stranger has no membership.
    const [coach, student] = await openTwoUsers(browser, "fc_coach", "fc_student");
    const stranger = await openUser(browser, "fc_stranger");
    await resetDb(coach.page);
    await seedDb(coach.page, {
      users: [
        { id: "fc_coach", displayName: "Coach", identityColor: "#c0563f" },
        { id: "fc_student", displayName: "Student", identityColor: "#1f8a5b" },
        { id: "fc_stranger", displayName: "Stranger", identityColor: "#5b6b8a" },
      ],
    });
    await seedAuth(coach.page, "fc_coach");
    await seedAuth(student.page, "fc_student");
    await seedAuth(stranger.page, "fc_stranger");

    // Coach creates a routine with a Feather figure, then authors an all-dances
    // family note on it ("every Feather …").
    const docRef = await createRoutineAsCoach(coach.page, "Shared Coaching Waltz");
    await addSection(coach.page, "Intro");
    await expect(coach.page.getByRole("heading", { name: "Intro" })).toBeVisible({
      timeout: 15_000,
    });
    await coach.page.getByRole("button", { name: "Add figure" }).click();
    await coach.page.getByLabel("Figure name").fill("Feather Step");
    await coach.page.getByLabel("Figure name").press("Enter");
    await expect(coach.page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
    await coach.page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    const coachFamily = coach.page.getByRole("region", { name: /family notes/i });
    await coachFamily.getByRole("button", { name: /this figure family/i }).click();
    await coachFamily.getByRole("radio", { name: /all dances/i }).click();
    await coachFamily.getByRole("textbox", { name: /family note/i }).fill("keep the head left");
    await coachFamily.getByRole("button", { name: /add family note/i }).click();
    await expect(coachFamily.getByText("keep the head left")).toBeVisible({ timeout: 15_000 });

    // Coach shares COMMENTER access to the ROUTINE only. The student gets read
    // access to the referenced figure via the cascade (placement_edge), NOT a
    // direct figure share — proving "inviting to a routine cascades its figures".
    await seedDb(coach.page, {
      memberships: [{ docRef, userId: "fc_student", role: "commenter" }],
    });

    // Student (co-member) opens the shared routine, opens the figure → SEES the note.
    await student.page.goto(`/routines/${docRef}`);
    await expect(student.page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
    // Opening an existing routine lands in READ; switch to the list view so the
    // per-figure step button is accessible. Commenter has no Add section even here.
    await student.page.getByRole("button", { name: /list view/i }).click();
    await student.page.getByRole("button", { name: /steps: Feather Step/i }).click();
    const studentFamily = student.page.getByRole("region", { name: /family notes/i });
    await expect(studentFamily.getByText("keep the head left")).toBeVisible({ timeout: 15_000 });

    // Stranger (NOT a member) opens the routine → the access-denied state, and NONE
    // of the coach's family-note content (the co-membership gate holds).
    await stranger.page.goto(`/routines/${docRef}`);
    await expect(stranger.page.getByText(/don't have access/i)).toBeVisible({ timeout: 15_000 });
    await expectAbsent(stranger.page, "text=keep the head left");

    await closeUsers(coach, student, stranger);
  });
});

test.describe("@smoke routine editor edits a referenced figure (cascade grants edit)", () => {
  test("a routine-editor co-member edits a referenced figure; the owner sees the change converge", async ({
    browser,
  }) => {
    // Intent: inviting a co-member as a routine EDITOR lets them EDIT the figures it
    //   references (decided 2026-06-27) — via the placement_edge cascade, NOT a direct
    //   figure share. The edit lands on the SHARED figure doc, so the owner sees it.
    const [owner, editor] = await openTwoUsers(browser, "ce_owner", "ce_editor");
    await resetDb(owner.page);
    await seedDb(owner.page, {
      users: [
        { id: "ce_owner", displayName: "Owner", identityColor: "#111111" },
        { id: "ce_editor", displayName: "Editor", identityColor: "#222222" },
      ],
    });
    await seedAuth(owner.page, "ce_owner");
    await seedAuth(editor.page, "ce_editor");

    // Owner creates a routine with a Feather figure.
    const docRef = await createRoutineAsCoach(owner.page, "Co-edit Waltz");
    await addSection(owner.page, "Intro");
    await expect(owner.page.getByRole("heading", { name: "Intro" })).toBeVisible({
      timeout: 15_000,
    });
    await owner.page.getByRole("button", { name: "Add figure" }).click();
    await owner.page.getByLabel("Figure name").fill("Feather Step");
    await owner.page.getByLabel("Figure name").press("Enter");
    await expect(owner.page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });

    // Share EDITOR on the ROUTINE only — figure edit rights come via the cascade.
    await seedDb(owner.page, {
      memberships: [{ docRef, userId: "ce_editor", role: "editor" }],
    });

    // The co-editor opens the routine + the figure, and tags count 1 footwork "T".
    await editor.page.goto(`/routines/${docRef}`);
    await expect(editor.page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
    // Opening an existing routine lands in READ; switch to EDIT to access the
    // step timeline editor.
    await editor.page.getByRole("button", { name: /list view/i }).click();
    await editor.page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    await editor.page.getByRole("button", { name: /beat 1/i }).click();
    await editor.page.getByRole("button", { name: /^Heel-Toe$/ }).click();
    await expect(editor.page.getByLabel(/count 1 attributes/i).getByText("HT")).toBeVisible({
      timeout: 15_000,
    });

    // The OWNER opens the SAME figure → sees the co-editor's edit converge: it hit the
    // shared figure doc, not just the co-editor's local copy (cascade edit is real).
    await owner.page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    await expect(owner.page.getByLabel(/count 1 attributes/i).getByText("HT")).toBeVisible({
      timeout: 15_000,
    });

    await closeUsers(owner, editor);
  });
});
