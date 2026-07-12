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
// @smoke includes one fork/copy-on-write journey (PLAN §10.3). All journeys in
// this file are LIVE — the last skipped slice (the US-040 cross-dance
// figureType-note journey) was unskipped and scripted 2026-07-03.
// ─────────────────────────────────────────────────────────────────────────

/** Coach creates a routine via the UI; returns its docRef (from the URL). */
async function createRoutineAsCoach(page: Page, title: string): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: /new choreo/i }).click();
  await page.getByLabel("Choreo name").fill(title);
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

/** Place the CATALOG "Running Spin Turn" from the picker's preset list (a live
 *  global reference). Typing the name instead would mint a CUSTOM figure —
 *  the custom form always creates your own, even for a catalog name (§4.3). */
async function placeRunningSpinTurn(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add figure" }).click();
  await page.getByRole("button", { name: "Running Spin Turn", exact: true }).click();
  // Portion picker (Builder v3 ③): whole figure pre-selected — confirm.
  await page.getByRole("button", { name: /add to choreo/i }).click();
  await expect(page.getByText("Running Spin Turn")).toBeVisible({ timeout: 15_000 });
}

/** Open the step editor and quick-add a sub-beat step at count 5&. */
async function retimeFiveAnd(page: Page): Promise<void> {
  await page.getByRole("button", { name: /edit steps: Running Spin Turn/i }).click();
  await page.getByRole("button", { name: /^Add Step at count 5&$/i }).click();
  await expect(page.getByRole("button", { name: /^Edit Step at count 5&$/i })).toBeVisible({
    timeout: 15_000,
  });
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
    await page.getByRole("button", { name: /create my own figure/i }).click();
    await page.getByLabel("Figure name").fill("Feather Step");
    await page.getByLabel("Figure name").press("Enter");

    // A typed name always mints a custom figure (§4.3) — whose full-screen
    // editor opens IMMEDIATELY (create-navigates). Set
    // count-1 footwork "HT" via the Step cell's single-attribute overlay.
    await expect(page.getByRole("dialog", { name: /steps · feather step/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /Step at count 1$/i }).click();
    await page.getByRole("button", { name: /^Heel-Toe$/ }).click();
    await page.getByRole("button", { name: /^Done$/ }).click();
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
    // Intent: editing a global (catalog) figure silently spawns a live overlay
    // VARIANT (owning only the edited beats — ⟳v5, §5.2), re-points the placement,
    // and shows "Made this figure yours". The base global figure is untouched —
    // proved at the worker layer; this test verifies the UI observables: toast + the
    // divergence-derived "Custom" badge.
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

    // Open the figure's steps and trigger copy-on-write by editing count 1 —
    // the empty cell quick-adds a blank step (itself the first edit, Builder
    // v3 ②), then the second tap opens the overlay to pick a footwork.
    await page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    await page.getByRole("button", { name: /^Add Step at count 1$/i }).click();
    await page.getByRole("button", { name: /^Edit Step at count 1$/i }).click();
    // "Heel-Toe" is a footwork suggestion in the Step overlay.
    await page.getByRole("button", { name: /^Heel-Toe$/ }).click();

    // The FigureTimeline immediately shows "Made this figure yours" (local state).
    // Use .first() because both FigureTimeline (on `copied`) and Assemble (`copiedToast`)
    // can briefly show this text simultaneously — M3 strict-mode flake guard.
    await expect(page.getByText(/made this figure yours/i).first()).toBeVisible({
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

  test("re-timing a placed CATALOG figure (sub-beat quick-add) persists as your variant (US-035)", async ({
    page,
  }) => {
    // Intent (the reported bug): a catalog figure placed via the Add-figure sheet is
    //   a LIVE REFERENCE to a `global:` doc that is NOT seeded as its own DO — its
    //   content comes from the bundled catalog (⟳v5, §4.3). Re-timing it by
    //   quick-adding a sub-beat step (the "&" between 5 and 6 → count 5&) used to
    //   fire the "Step placed" toast but DROP the edit: the store read the figure's
    //   scope from the (unhydrated) live connection, missed the `global` scope, and
    //   attempted an in-place write the DO silently rejects. It must instead spawn a
    //   live variant that OWNS the re-timed beat, so the new step persists across a
    //   reload (⟳v5, §4.4/§5.2). Unlike the seeded-global test above, NO figure DO is
    //   seeded here — this is the real "add a catalog figure, then re-time it" path.
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: "user_editor", displayName: "Editor", identityColor: "#222222" }],
    });
    await seedAuth(page, "user_editor");

    // Create a Waltz routine + section, then place the CATALOG "Running Spin Turn"
    // from the preset list (a live reference — no figure DO is seeded).
    const docRef = await createRoutineAsCoach(page, "Re-time Waltz");
    await addSection(page, "Intro");
    await expect(page.getByRole("heading", { name: "Intro" })).toBeVisible({ timeout: 15_000 });
    await placeRunningSpinTurn(page);

    // Open the figure's step editor and quick-add a step at the "&" between 5 and 6
    // (count 5&): tapping an empty Step sub-beat cell quick-adds a presence step
    // (Builder v3 ②) — the "Step placed" toast fires here.
    await page.getByRole("button", { name: /edit steps: Running Spin Turn/i }).click();
    await page.getByRole("button", { name: /^Add Step at count 5&$/i }).click();

    // The re-timed sub-beat now carries a step: the cell flips from "Add" to "Edit".
    // This is the discriminating check — pre-fix the edit was dropped, so the cell
    // stayed "Add Step at count 5&" (the presence never reached a persisted doc).
    await expect(page.getByRole("button", { name: /^Edit Step at count 5&$/i })).toBeVisible({
      timeout: 15_000,
    });

    // …and it PERSISTS across a reload: the step landed on the spawned variant's own
    // DO (a real choreo-owned figure), not on the rejected global write.
    await page.reload();
    await page.goto(`/routines/${docRef}`);
    await expect(page.getByText("Running Spin Turn")).toBeVisible({ timeout: 15_000 });
    // Opening an existing routine lands in READ; switch to EDIT for the step editor.
    await page.getByRole("button", { name: /list view/i }).click();
    await page.getByRole("button", { name: /edit steps: Running Spin Turn/i }).click();
    await expect(page.getByRole("button", { name: /^Edit Step at count 5&$/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("re-timing the SAME catalog figure again (second routine) still persists — you can own many variants of one base (migration 0017)", async ({
    page,
  }) => {
    // REGRESSION (the reported production bug): re-timing a placed catalog figure
    //   spawns a variant stamped `forkedFromRef = global:waltz:running-spin-turn`.
    //   Once you own ONE such variant, migration 0010's UNIQUE(ownerId,
    //   forkedFromRef) made the SECOND variant's POST /api/figures 409 →
    //   `spawnVariantForEdit` dropped the edit AFTER the optimistic "Step placed"
    //   toast, so the step vanished on reload. The single-routine test above passes
    //   on a fresh account (no prior derivative), which is exactly why CI missed
    //   this. Here we re-time the SAME catalog figure a SECOND time (a second
    //   routine) — the account now already owns a derivative — and it must persist.
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: "user_editor", displayName: "Editor", identityColor: "#222222" }],
    });
    await seedAuth(page, "user_editor");

    // Routine 1 → the account's FIRST variant of Running Spin Turn.
    await createRoutineAsCoach(page, "Re-time Waltz A");
    await addSection(page, "Intro");
    await expect(page.getByRole("heading", { name: "Intro" })).toBeVisible({ timeout: 15_000 });
    await placeRunningSpinTurn(page);
    await retimeFiveAnd(page);

    // Routine 2 → a SECOND variant of the SAME base. Pre-0017 this 409'd and the
    // step silently vanished; now it must land on its own variant and persist.
    const docRef2 = await createRoutineAsCoach(page, "Re-time Waltz B");
    await addSection(page, "Intro");
    await expect(page.getByRole("heading", { name: "Intro" })).toBeVisible({ timeout: 15_000 });
    await placeRunningSpinTurn(page);
    await retimeFiveAnd(page);

    // …and it PERSISTS across a reload of the second routine.
    await page.reload();
    await page.goto(`/routines/${docRef2}`);
    await expect(page.getByText("Running Spin Turn")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /list view/i }).click();
    await page.getByRole("button", { name: /edit steps: Running Spin Turn/i }).click();
    await expect(page.getByRole("button", { name: /^Edit Step at count 5&$/i })).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("cross-dance figureType notes (US-040)", () => {
  test("an all-dances family note surfaces on a Feather in BOTH a Foxtrot and a Waltz routine; a this-dance note stays in its dance", async ({
    page,
  }) => {
    // Intent: a figureType note scoped "all dances" surfaces on every matching
    //   figure across dances; a this-dance note only in its dance (US-040).
    // User scenario: the user annotates "every Feather: keep the head left"
    //   (all dances) plus a foxtrot-only pointer, from the Foxtrot routine.
    // Steps/asserts:
    //   1. Seed two routines (foxtrot + waltz), each placing a figure of the
    //      SAME family (feather_step) in its dance.
    //   2. In the Foxtrot routine, author an all-dances family note and a
    //      this-dance note.
    //   3. The Waltz routine's Feather shows the all-dances note (cross-dance)
    //      but NOT the foxtrot-only one.
    await seedAuth(page, "xd_owner");
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: "xd_owner", displayName: "Owner", identityColor: "#c0563f" }],
      figures: [
        {
          docRef: "fig_fox_feather",
          scope: "account",
          ownerId: "xd_owner",
          name: "Feather Step",
          dance: "foxtrot",
          figureType: "feather_step",
        },
        {
          docRef: "fig_waltz_feather",
          scope: "account",
          ownerId: "xd_owner",
          name: "Waltz Feather",
          dance: "waltz",
          figureType: "feather_step",
        },
      ],
      docs: [
        {
          docRef: "rt_fox_notes",
          type: "routine",
          ownerId: "xd_owner",
          title: "Foxtrot Notes",
          dance: "foxtrot",
          sections: [
            {
              id: "s_fox",
              name: "Main",
              placements: [{ id: "p_fox", figureRef: "fig_fox_feather" }],
            },
          ],
        },
        {
          docRef: "rt_waltz_notes",
          type: "routine",
          ownerId: "xd_owner",
          title: "Waltz Notes",
          dance: "waltz",
          sections: [
            {
              id: "s_waltz",
              name: "Main",
              placements: [{ id: "p_waltz", figureRef: "fig_waltz_feather" }],
            },
          ],
        },
      ],
      placementEdges: [
        { routineRef: "rt_fox_notes", figureRef: "fig_fox_feather" },
        { routineRef: "rt_waltz_notes", figureRef: "fig_waltz_feather" },
      ],
    });

    // 1. Foxtrot routine: author the two family notes from the figure editor.
    await gotoRoutine(page, "rt_fox_notes");
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
    // Opening an existing routine lands in READ; switch to the list (edit) view
    // where the per-figure "edit steps" affordance lives.
    await page.getByRole("button", { name: /list view/i }).click();
    await page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    const foxFamily = page.getByRole("region", { name: /family notes/i });
    await foxFamily.getByRole("button", { name: /this figure family/i }).click();
    await foxFamily.getByRole("radio", { name: /all dances/i }).click();
    await foxFamily.getByRole("textbox", { name: /family note/i }).fill("keep the head left");
    await foxFamily.getByRole("button", { name: /add family note/i }).click();
    await expect(foxFamily.getByText("keep the head left")).toBeVisible({ timeout: 15_000 });

    await foxFamily.getByRole("radio", { name: /this dance/i }).click();
    await foxFamily
      .getByRole("textbox", { name: /family note/i })
      .fill("foxtrot only: lower earlier");
    await foxFamily.getByRole("button", { name: /add family note/i }).click();
    await expect(foxFamily.getByText("foxtrot only: lower earlier")).toBeVisible({
      timeout: 15_000,
    });

    // 2. Waltz routine, same family: the all-dances note surfaces (US-040 AC-1),
    //    the foxtrot-only one does not (AC-2).
    await gotoRoutine(page, "rt_waltz_notes");
    await expect(page.getByText("Waltz Feather")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /list view/i }).click();
    await page.getByRole("button", { name: /edit steps: Waltz Feather/i }).click();
    const waltzFamily = page.getByRole("region", { name: /family notes/i });
    await expect(waltzFamily.getByText("keep the head left")).toBeVisible({ timeout: 15_000 });
    await expect(waltzFamily.getByText("foxtrot only: lower earlier")).not.toBeVisible();
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
    await coach.page.getByRole("button", { name: /create my own figure/i }).click();
    await coach.page.getByLabel("Figure name").fill("Feather Step");
    await coach.page.getByLabel("Figure name").press("Enter");
    // The custom mint opens its step editor immediately (create-navigates, §4.3).
    // Notes live on the READING-lens detail (the editing lens is notation-only),
    // so close it, switch lens, and reopen the figure by name.
    await expect(coach.page.getByRole("dialog", { name: /steps · feather step/i })).toBeVisible({
      timeout: 15_000,
    });
    await coach.page.keyboard.press("Escape");
    await coach.page.getByRole("button", { name: /reading view/i }).click();
    await coach.page
      .getByTestId("reading-view")
      .getByRole("button", { name: "Feather Step", exact: true })
      .click();
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
    // Opening an existing routine lands in READ — exactly where notes surface:
    // the reading-lens figure detail. Open it by tapping the figure name.
    await student.page
      .getByTestId("reading-view")
      .getByRole("button", { name: "Feather Step", exact: true })
      .click();
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
    await owner.page.getByRole("button", { name: /create my own figure/i }).click();
    await owner.page.getByLabel("Figure name").fill("Feather Step");
    await owner.page.getByLabel("Figure name").press("Enter");
    // The custom mint opens its step editor immediately (create-navigates, §4.3) —
    // close it; this test drives the CO-EDITOR's edit first.
    await expect(owner.page.getByRole("dialog", { name: /steps · feather step/i })).toBeVisible({
      timeout: 15_000,
    });
    await owner.page.keyboard.press("Escape");
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
    await editor.page.getByRole("button", { name: /^Add Step at count 1$/i }).click();
    await editor.page.getByRole("button", { name: /^Edit Step at count 1$/i }).click();
    await editor.page.getByRole("button", { name: /^Heel-Toe$/ }).click();
    await editor.page.getByRole("button", { name: /^Done$/ }).click();
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
