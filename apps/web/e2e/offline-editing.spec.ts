import { expect, type Page, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";
import { mintTestJWT } from "./support/jwt";
import { closeUsers, expectConverged, openTwoUsers } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// Offline editing (PLAN §11.2 — the v1.1 done bar). CRDT edits to an
// ALREADY-HYDRATED doc keep working while disconnected: they are remembered
// locally (IndexedDB behind DocConnection, surviving a reload) and replayed to
// the DO on reconnect via the shipped resend machinery (D10). Two journeys:
//
//  1. Edit offline → reload offline (edits survive from IndexedDB) → reconnect
//     → both clients CONVERGE with zero lost or duplicated edits.
//  2. The ugly case (research/critique-sync.md Q-NEW-2): access revoked while
//     offline → the reconnect is terminally rejected → the client SURFACES the
//     unsyncable edits explicitly. Silent loss is the one forbidden outcome.
//
// @smoke — this journey is the feature's PR gate (delivery model, CLAUDE.md §6).
// ─────────────────────────────────────────────────────────────────────────

const COACH = "user_coach";
const STUDENT = "user_student";

/** Wait until the service worker is ACTIVE and CONTROLLING the page, so an
 *  offline reload serves the app shell from the SW precache (pwa-a11y pattern). */
async function serviceWorkerControls(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
}

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

/** Seed the shared two-user world and open the routine as the student (editor). */
async function setUpSharedRoutine(
  coach: { page: Page },
  student: { page: Page },
  title: string,
): Promise<string> {
  await resetDb(coach.page);
  await seedDb(coach.page, {
    users: [
      { id: COACH, displayName: "Coach", identityColor: "#111111" },
      { id: STUDENT, displayName: "Student", identityColor: "#222222" },
    ],
  });
  await seedAuth(coach.page, COACH);
  await seedAuth(student.page, STUDENT);

  const docRef = await createRoutineAsCoach(coach.page, title);
  await seedDb(coach.page, { memberships: [{ docRef, userId: STUDENT, role: "editor" }] });
  await student.page.goto(`/routines/${docRef}`);
  // Opening an existing routine lands in READ; switch to EDIT for the builder.
  await student.page.getByRole("button", { name: /list view/i }).click();
  await expect(student.page.getByRole("button", { name: "Add section" })).toBeVisible({
    timeout: 15_000,
  });
  return docRef;
}

test.describe("@smoke offline editing (PLAN §11.2)", () => {
  test("offline edits survive a reload and converge on reconnect, exactly once", async ({
    browser,
  }) => {
    // Intent: the §11.2 core journey. The student edits a hydrated routine while
    //   OFFLINE; the edit is visibly pending, survives an offline reload (local
    //   persistence), and on reconnect both clients converge — the offline edit
    //   reaches the coach, the coach's online edit reaches the student, and the
    //   idempotent replay applies the offline edit exactly once.
    const [coach, student] = await openTwoUsers(browser, COACH, STUDENT);
    await setUpSharedRoutine(coach, student, "Offline Waltz");
    // Prime the SW precache so the offline reload below can serve the app shell.
    await serviceWorkerControls(student.page);

    // ── The student disconnects and keeps editing ────────────────────────────
    await student.context.setOffline(true);
    await addSection(student.page, "Offline Solo");
    await expect(student.page.locator("[data-testid='section-list']")).toContainText(
      "Offline Solo",
    );
    // Truth-telling (§11.2): the pending state is visible, never silent.
    await expect(student.page.getByTestId("pending-sync")).toBeVisible();

    // Meanwhile the coach keeps editing ONLINE.
    await addSection(coach.page, "Online Coda");
    await expect(coach.page.locator("[data-testid='section-list']")).toContainText("Online Coda");

    // ── Offline RELOAD: the edit must survive from local persistence ─────────
    await student.page.reload();
    await student.page.getByRole("button", { name: /list view/i }).click();
    await expect(student.page.locator("[data-testid='section-list']")).toContainText(
      "Offline Solo",
      { timeout: 15_000 },
    );
    await expect(student.page.getByTestId("pending-sync")).toBeVisible();

    // ── Reconnect: replay + converge, zero lost edits, exactly once ──────────
    await student.context.setOffline(false);
    await expectConverged(
      [coach.page, student.page],
      "[data-testid='section-list']",
      "Offline Solo",
    );
    await expectConverged(
      [coach.page, student.page],
      "[data-testid='section-list']",
      "Online Coda",
    );
    // Idempotent replay: the offline edit appears exactly ONCE on both clients.
    await expect(student.page.getByRole("heading", { name: "Offline Solo" })).toHaveCount(1);
    await expect(coach.page.getByRole("heading", { name: "Offline Solo" })).toHaveCount(1);
    // Everything synced → the pending indicator resolves away.
    await expect(student.page.getByTestId("pending-sync")).toHaveCount(0, { timeout: 15_000 });

    await closeUsers(coach, student);
  });

  test("creation is live-gated: the new-choreo affordance disables offline, re-enables online", async ({
    browser,
  }) => {
    // Intent (§11.2 scope boundary): creating a choreo is a SERVER action
    //   (quota check + D1 registry row + DO seeding) — offline it must be a
    //   visibly disabled affordance, never a queued half-action or a silent
    //   failure (the bug: the + stayed enabled offline and the create vanished).
    const [solo] = await openTwoUsers(browser, COACH, STUDENT);
    await resetDb(solo.page);
    await seedDb(solo.page, {
      users: [{ id: COACH, displayName: "Coach", identityColor: "#111111" }],
    });
    await seedAuth(solo.page, COACH);
    await solo.page.goto("/");
    const newChoreo = solo.page.getByRole("button", { name: /new choreo/i });
    await expect(newChoreo).toBeEnabled();

    await solo.context.setOffline(true);
    await expect(newChoreo).toBeDisabled(); // the useOnline poll notices within ~2s

    await solo.context.setOffline(false);
    await expect(newChoreo).toBeEnabled();
    await closeUsers(solo);
  });

  test("the installed app OPENS offline to the last-known choreo list, not a spinner", async ({
    browser,
  }) => {
    // Intent (§11.2 — offline app open): launching the installed PWA in
    //   airplane mode must land on the normal choreo list served from the
    //   on-device cache (the reported bug: an endless boot spinner). A user
    //   with zero choreos gets the normal empty view the same way.
    const [solo] = await openTwoUsers(browser, COACH, STUDENT);
    await resetDb(solo.page);
    await seedDb(solo.page, {
      users: [{ id: COACH, displayName: "Coach", identityColor: "#111111" }],
    });
    await seedAuth(solo.page, COACH);
    await createRoutineAsCoach(solo.page, "Cached Waltz");
    // Land on the list once ONLINE (writes the offline cache + primes the SW).
    await solo.page.goto("/");
    await expect(solo.page.getByText("Cached Waltz")).toBeVisible({ timeout: 15_000 });
    await serviceWorkerControls(solo.page);

    // The offline LAUNCH: reload with no network → the list renders from cache.
    await solo.context.setOffline(true);
    await solo.page.reload();
    await expect(solo.page.getByText("Cached Waltz")).toBeVisible({ timeout: 15_000 });
    await expect(solo.page.getByTestId("offline-banner")).toBeVisible();
    // Creation stays gated; opening the cached choreo still works (§11.2 reads).
    await expect(solo.page.getByRole("button", { name: /new choreo/i })).toBeDisabled();

    await solo.context.setOffline(false);
    await closeUsers(solo);
  });

  test("access revoked while offline → the unsyncable edits are surfaced, never dropped", async ({
    browser,
  }) => {
    // Intent: the §11.2 forbidden-outcome guard (critique-sync Q-NEW-2). The
    //   student edits offline; the coach removes them; the student's reconnect is
    //   terminally rejected (fail-closed DO boundary). The client must show an
    //   EXPLICIT "these changes could not be saved" outcome — and keep the local
    //   content readable — rather than silently dropping the edits.
    const [coach, student] = await openTwoUsers(browser, COACH, STUDENT);
    const docRef = await setUpSharedRoutine(coach, student, "Revoked Waltz");

    await student.context.setOffline(true);
    await addSection(student.page, "Doomed Edit");
    await expect(student.page.locator("[data-testid='section-list']")).toContainText("Doomed Edit");
    await expect(student.page.getByTestId("pending-sync")).toBeVisible();

    // The coach removes the student while they're offline (US-024 member removal
    // — the real product surface the DO boundary enforces on reconnect).
    const coachToken = await mintTestJWT(COACH);
    const res = await coach.page.request.delete(
      `/api/docs/${encodeURIComponent(docRef)}/members/${STUDENT}`,
      { headers: { Authorization: `Bearer ${coachToken}` } },
    );
    expect(res.ok(), "member removal should succeed").toBeTruthy();

    // Reconnect: the handshake is now rejected → after bounded retries the
    // connection is terminally closed. The unsyncable edits must be SURFACED…
    await student.context.setOffline(false);
    await expect(student.page.getByTestId("unsynced-changes")).toBeVisible({ timeout: 30_000 });
    // …and the locally-persisted content stays READABLE (not blanked away).
    // The screen stays on the edit lens it was on — the store survives the
    // access flip (no remount), so the section list is still right there.
    await expect(student.page.locator("[data-testid='section-list']")).toContainText("Doomed Edit");

    await closeUsers(coach, student);
  });
});
