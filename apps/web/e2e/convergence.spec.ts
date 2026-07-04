import { expect, type Page, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";
import { closeUsers, expectConverged, openTwoUsers } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// Two live clients converge on a routine (PLAN §10.2 E2E: "two live contexts
// converge on a routine"). Covers US-015 (live WS sync) + US-052 (cross-browser).
//
// This is the FE-4 ship gate: the DO + Hibernatable-WS + Automerge sync is unit-
// proven at the DO level (doc-do.test), and the client `DocConnection` speaks the
// same binary change protocol — but until now nothing proved two REAL browsers
// converging end-to-end. These journeys do, against the #191 real-worker harness.
//
// Setup: the coach creates a routine through the UI (a real, server-seeded doc),
// then we grant the student editor rights on that doc, so both are live editors
// of ONE document's DO. Convergence is asserted on observable DOM via
// expectConverged (Playwright auto-retry, NO sleeps).
//
// @smoke — the CI smoke subset includes one convergence journey.
// ─────────────────────────────────────────────────────────────────────────

const COACH = "user_coach";
const STUDENT = "user_student";

/** Coach creates a routine via the UI; returns its docRef (read from the URL). */
async function createRoutineAsCoach(page: Page, title: string): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: /new choreo/i }).click();
  await page.getByLabel("Choreo name").fill(title);
  // Waltz is the pre-selected chip in the New-choreo sheet, so no dance pick needed.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /create choreo/i })
    .click();
  // The add-section affordance proves we opened the new doc with edit rights.
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

test.describe("@smoke two clients converge on a routine", () => {
  test("an edit by user A appears live for user B and vice versa", async ({ browser }) => {
    // Intent: two co-editing members see each other's edits without reload, in
    //   BOTH directions (live, bidirectional WS sync). US-015 AC-1 + US-052.
    const [coach, student] = await openTwoUsers(browser, COACH, STUDENT);
    await resetDb(coach.page);
    await seedDb(coach.page, {
      users: [
        { id: COACH, displayName: "Coach", identityColor: "#111111" },
        { id: STUDENT, displayName: "Student", identityColor: "#222222" },
      ],
    });
    await seedAuth(coach.page, COACH);
    await seedAuth(student.page, STUDENT);

    const docRef = await createRoutineAsCoach(coach.page, "Sync Waltz");
    // Grant the student edit rights on the just-created doc, then they open it.
    await seedDb(coach.page, { memberships: [{ docRef, userId: STUDENT, role: "editor" }] });
    await student.page.goto(`/routines/${docRef}`);
    // Opening an existing routine lands in READ; switch to EDIT so the section
    // builder affordances are visible before asserting / editing below.
    await student.page.getByRole("button", { name: /list view/i }).click();
    await expect(student.page.getByRole("button", { name: "Add section" })).toBeVisible({
      timeout: 15_000,
    });

    // 1. Coach → Student: the coach adds "Coda"; the student sees it live.
    await addSection(coach.page, "Coda");
    await expectConverged([coach.page, student.page], "[data-testid='section-list']", "Coda");

    // 2. Student → Coach (reverse direction): sync is bidirectional.
    await addSection(student.page, "Bridge");
    await expectConverged([coach.page, student.page], "[data-testid='section-list']", "Bridge");

    await closeUsers(coach, student);
  });

  test("a reconnecting client re-hydrates without duplicating edits (idempotent replay)", async ({
    browser,
  }) => {
    // Intent: a duplicate change delivery — here a full catch-up replay on
    //   reconnect (reload → fresh socket → DO replays its whole history) — must be
    //   idempotent: the edit appears exactly once, never doubled. US-015 AC-3.
    const [coach, student] = await openTwoUsers(browser, COACH, STUDENT);
    await resetDb(coach.page);
    await seedDb(coach.page, {
      users: [
        { id: COACH, displayName: "Coach", identityColor: "#111111" },
        { id: STUDENT, displayName: "Student", identityColor: "#222222" },
      ],
    });
    await seedAuth(coach.page, COACH);
    await seedAuth(student.page, STUDENT);

    const docRef = await createRoutineAsCoach(coach.page, "Replay Waltz");
    await seedDb(coach.page, { memberships: [{ docRef, userId: STUDENT, role: "editor" }] });
    await student.page.goto(`/routines/${docRef}`);
    // Opening an existing routine lands in READ; switch to EDIT so the section
    // builder affordances are visible before asserting / editing below.
    await student.page.getByRole("button", { name: /list view/i }).click();
    await expect(student.page.getByRole("button", { name: "Add section" })).toBeVisible({
      timeout: 15_000,
    });

    // Student adds one section; both converge on a single "Solo".
    await addSection(student.page, "Solo");
    await expectConverged([coach.page, student.page], "[data-testid='section-list']", "Solo");

    // Student reconnects (reload → fresh socket → full catch-up replay). A non-
    // idempotent replay would double-apply the change; assert exactly ONE "Solo".
    await student.page.reload();
    // Reload returns to READ; switch back to EDIT so section headings are visible.
    await student.page.getByRole("button", { name: /list view/i }).click();
    await expect(student.page.getByRole("heading", { name: "Solo" })).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(coach.page.getByRole("heading", { name: "Solo" })).toHaveCount(1);

    await closeUsers(coach, student);
  });
});
