import { expect, type Page, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";
import { closeUsers, expectConverged, openTwoUsers } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// WEP-0006 ship gate — zombie-socket heartbeat. The practice-room dead spot:
// the network dies under an ESTABLISHED socket without the browser noticing
// (`navigator.onLine` stays true, no close event — an AP reboot). Before the
// heartbeat, edits made in that window vanished into the dead pipe while the
// UI read "live", until the OS's own TCP timeout (minutes). The journey below
// manufactures exactly that state via the E2E socket seam
// (`window.__weaveZombifySockets`, apps/web/src/store/e2e-socket.ts) and
// asserts the heartbeat detects it, reconnects, and replays the gap edit —
// proven by CONVERGENCE on a second live client, not by local persistence
// (a reload could serve the edit from IndexedDB; only the coach seeing it
// proves the server got it).
//
// The E2E build shortens the heartbeat (1.5 s idle ping / 0.75 s deadline), so
// every journey in the suite also continuously exercises real ping→pong
// delivery against the real worker's auto-response.
//
// @smoke — this journey is the feature's PR gate (delivery model, CLAUDE.md §6).
// ─────────────────────────────────────────────────────────────────────────

const COACH = "user_coach";
const STUDENT = "user_student";

/** Coach creates a routine via the UI; returns its docRef (read from the URL). */
async function createRoutineAsCoach(page: Page, title: string): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: /new choreo/i }).click();
  await page.getByLabel("Choreo name").fill(title);
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

test.describe("@smoke zombie-socket heartbeat (WEP-0006)", () => {
  test("a half-open socket is detected, reconnected, and the gap edit converges", async ({
    browser,
  }) => {
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

    const docRef = await createRoutineAsCoach(coach.page, "Zombie Waltz");
    await seedDb(coach.page, { memberships: [{ docRef, userId: STUDENT, role: "editor" }] });
    await student.page.goto(`/routines/${docRef}`);
    await student.page.getByRole("button", { name: /list view/i }).click();
    await expect(student.page.getByRole("button", { name: "Add section" })).toBeVisible({
      timeout: 15_000,
    });

    // ── The dead spot: the student's sockets go half-open ────────────────────
    // The browser is NOT told anything — navigator.onLine stays true, no close
    // event fires. Only the heartbeat can notice this.
    const zombified = await student.page.evaluate(() => window.__weaveZombifySockets?.() ?? 0);
    expect(zombified, "the E2E zombie seam should have live sockets to kill").toBeGreaterThan(0);
    expect(await student.page.evaluate(() => navigator.onLine)).toBe(true);

    // An edit made INTO the zombie window — pre-heartbeat this vanished into the
    // dead pipe while the UI read "live".
    await addSection(student.page, "Ghost Section");
    await expect(student.page.locator("[data-testid='section-list']")).toContainText(
      "Ghost Section",
    );

    // ── Detection + self-heal ────────────────────────────────────────────────
    // Idle ping (≤1.5 s) → missed pong deadline (0.75 s) → warm reconnect
    // (backoff from 1 s) → snapshot catch-up + #161 resend of the gap edit.
    // The proof the server received it: the COACH's live client converges on
    // the section (local persistence could fake a reload, never a peer).
    await expectConverged(
      [coach.page, student.page],
      "[data-testid='section-list']",
      "Ghost Section",
    );
    // And the healed connection carries traffic both ways again.
    await addSection(coach.page, "After The Storm");
    await expectConverged(
      [coach.page, student.page],
      "[data-testid='section-list']",
      "After The Storm",
    );

    await closeUsers(coach, student);
  });
});
