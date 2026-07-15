import { expect, type Page, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";
import { mintTestJWT } from "./support/jwt";
import { installOfflineControl } from "./support/offline";
import { closeUsers, openTwoUsers } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// WEP-0002 ship gate — the account doc, live. The per-user account doc
// (`account:<userId>`) is now a real per-document Durable Object, exactly like
// a routine or figure doc: family notes + library bookmarks are CRDT edits to
// an already-hydrated doc, so they inherit the shipped §11.2 offline machinery
// (IndexedDB persistence + replay-on-reconnect) and the alarm projects them
// into the D1 index co-members read.
//
// This journey proves that END TO END, the three scenarios from the WEP's Ship
// Gate:
//
//  1. A family note authored OFFLINE survives a reload while offline and replays
//     on reconnect, appearing exactly once (the offline-editing.spec pattern
//     applied to the account doc).
//  2. A bookmark added OFFLINE shows in the Library immediately and round-trips
//     to `GET /api/figures/mine` after reconnect + projection.
//  3. Visibility unchanged: a co-member on a shared routine sees the family note
//     on its matching figure; a non-member does not (Q-FIGNOTE-VIS option 2 —
//     the co-membership gate, never a peer reading another user's account doc).
//
// @smoke — this journey is WEP-0002's PR gate (delivery model, CLAUDE.md §6).
// ─────────────────────────────────────────────────────────────────────────

const COACH = "user_coach";
const STUDENT = "user_student";
const STRANGER = "user_stranger";

/** Wait until the service worker is ACTIVE and CONTROLLING the page, so an
 *  offline reload serves the app shell from the SW precache (pwa-a11y pattern,
 *  mirrors offline-editing.spec). */
async function serviceWorkerControls(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
}

/**
 * Wait until the doc keyed by `docKey` has HYDRATED and been persisted to
 * IndexedDB (the §11.2 local store, `weavesteps-docs` / `docs`). This is the
 * precondition for an offline edit to survive a reload: DocConnection.persistNow()
 * no-ops until `hydrated` is true (it refuses to clobber the good copy with an
 * empty A.init), and hydration lands only once the DO's seeded SNAPSHOT arrives —
 * which also fires the persist. A never-persisted doc reads back `null`, so this
 * poll (no arbitrary sleep) is a faithful "this connection is live + saved
 * locally" signal — used for both the account doc (whose compose/bookmark
 * surfaces expose no sync indicator) and the routine doc (whose Feather must be
 * on disk for the offline reload to re-render the figure detail).
 */
function persistedByteLength(page: Page, docKey: string): Promise<number> {
  return page.evaluate(
    (key: string) =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("weavesteps-docs", 1);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("docs")) {
            resolve(-1);
            return;
          }
          const req = db.transaction("docs", "readonly").objectStore("docs").get(key);
          req.onsuccess = () => {
            // The persisted row is `{ bytes: Uint8Array; pendingCount: number }`
            // (doc-storage.ts); read `bytes.byteLength` through runtime guards so
            // no type assertion is needed (CLAUDE.md §4). Absent/foreign → -1.
            const v: unknown = req.result;
            if (v && typeof v === "object" && "bytes" in v) {
              const bytes: unknown = v.bytes;
              if (bytes && typeof bytes === "object" && "byteLength" in bytes) {
                const len: unknown = bytes.byteLength;
                resolve(typeof len === "number" ? len : -1);
                return;
              }
            }
            resolve(-1);
          };
          req.onerror = () => resolve(-1);
        };
        open.onerror = () => resolve(-1);
      }),
    docKey,
  );
}

async function waitForDocPersisted(page: Page, docKey: string): Promise<void> {
  await expect
    .poll(async () => persistedByteLength(page, docKey), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

/**
 * Wait until an OFFLINE edit has been flushed to the doc's IndexedDB copy — the
 * durability barrier before a reload. DocConnection.persistNow() is fire-and-
 * forget (`void storage.save(...)`), so the read-your-own-write UI assertion can
 * pass while the async IndexedDB write is still in flight; reloading in that
 * window loses the edit. Poll the persisted byte length until it grows past its
 * pre-edit size — a deterministic "the edit is on disk" signal (no fixed sleep).
 */
async function waitForPersistedGrowth(page: Page, docKey: string, base: number): Promise<void> {
  await expect
    .poll(async () => persistedByteLength(page, docKey), { timeout: 20_000 })
    .toBeGreaterThan(base);
}

/** Create a Foxtrot routine via the UI; returns its docRef (read from the URL). */
async function createFoxtrotRoutine(page: Page, title: string): Promise<string> {
  await page.getByRole("button", { name: /new choreo/i }).click();
  await page.getByLabel("Choreo name").fill(title);
  await page.getByRole("button", { name: "Foxtrot" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /create choreo/i })
    .click();
  await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({ timeout: 15_000 });
  const docRef = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(docRef, "expected a created routine id in the URL").toBeTruthy();
  return docRef;
}

/** Add a section + place the CATALOG "Feather Step" into it (a live catalog ref,
 *  so both users share the same `figureType` a family note can attach to). */
async function addFeatherStep(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByLabel("Section name").fill("Intro");
  await page.getByLabel("Section name").press("Enter");
  await expect(page.getByRole("heading", { name: "Intro" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Add figure" }).click();
  await page.getByRole("button", { name: "Feather Step", exact: true }).click();
  await page.getByRole("button", { name: /add to choreo/i }).click();
  await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
}

/** Open the Feather Step's figure detail from the READING lens (where family
 *  notes live — the editing lens is notation-only, owner request 2026-07-08).
 *  Tolerant of the current lens: a just-built routine sits in EDIT, so we switch
 *  to reading; a freshly-opened (or reloaded) routine already lands in READ, so
 *  the "reading view" toggle is absent — skip it then and tap the figure. */
async function openFeatherDetailFromReading(page: Page): Promise<void> {
  const toReading = page.getByRole("button", { name: /reading view/i });
  if (await toReading.isVisible().catch(() => false)) await toReading.click();
  await page
    .getByTestId("reading-view")
    .getByRole("button", { name: "Feather Step", exact: true })
    .click({ timeout: 15_000 });
}

test.describe("@smoke account doc (WEP-0002)", () => {
  test("a family note authored OFFLINE survives an offline reload and replays on reconnect, exactly once", async ({
    browser,
  }) => {
    // Intent (WEP-0002 ship gate #1): a family note is the one annotation class
    //   that had no document behind it — a direct D1 insert that failed offline.
    //   With the account doc live it is a CRDT edit to an already-hydrated doc:
    //   authored offline, it is visible instantly (own notes read live from the
    //   doc), survives an offline reload (IndexedDB persistence), and on
    //   reconnect replays to the DO — projected to D1 exactly once (reused
    //   noteId ⇒ a stable-key upsert, never a duplicate).
    //
    // On mobile-safari `context.setOffline` + reload throws in WebKit (see
    // installOfflineControl); there we isolate only the account doc's sync
    // socket, which faithfully exercises the CRDT-resend + IndexedDB claims (the
    // reload navigates over a live network, yet the note can only have come from
    // IndexedDB — the account DO never received it while its socket was down).
    const isWebKit = test.info().project.name === "mobile-safari";
    const [coach] = await openTwoUsers(browser, COACH, STUDENT);
    // Install BEFORE the account doc connects so its socket is routable/droppable.
    const coachNet = await installOfflineControl(coach.context, isWebKit);

    await resetDb(coach.page);
    await seedDb(coach.page, {
      users: [{ id: COACH, displayName: "Coach", identityColor: "#111111" }],
    });
    await seedAuth(coach.page, COACH);
    await coach.page.goto("/");

    const docRef = await createFoxtrotRoutine(coach.page, "Offline Family Foxtrot");
    await addFeatherStep(coach.page);
    // Re-open the routine from a fresh navigation so BOTH the routine doc and the
    // account doc hydrate from the server AND persist to IndexedDB — the §11.2
    // precondition for an offline reload to serve them (a just-created routine's
    // content otherwise races the first IndexedDB write; mirrors offline-editing's
    // "open /routines/:id then edit" hydration path).
    await coach.page.goto(`/routines/${docRef}`);
    // Open the figure detail so the account doc (family-note compose) hydrates its
    // DocConnection BEFORE going offline (§11.2 edits an ALREADY-hydrated doc).
    await openFeatherDetailFromReading(coach.page);
    const family = coach.page.getByRole("region", { name: /family notes/i });
    await expect(family.getByRole("button", { name: /add family note/i })).toBeVisible({
      timeout: 15_000,
    });
    // Prime the SW precache so the offline reload can serve the app shell.
    await serviceWorkerControls(coach.page);
    // BOTH docs must be HYDRATED + persisted before we go offline, else their
    // offline commits/content are lost on the reload: the ROUTINE doc so the
    // Feather re-renders (to reopen its detail), and the ACCOUNT doc so the
    // offline note's persist doesn't no-op (won't clobber with an empty doc).
    await waitForDocPersisted(coach.page, docRef);
    await waitForDocPersisted(coach.page, `account:${COACH}`);
    const accountBytesBefore = await persistedByteLength(coach.page, `account:${COACH}`);

    // ── Offline: author an all-dances family note on the Feather family ───────
    await coachNet.goOffline();
    await family.getByRole("button", { name: /this figure family/i }).click();
    await family.getByRole("radio", { name: /all dances/i }).click();
    await family
      .getByRole("textbox", { name: /family note/i })
      .fill("on every Feather, keep the head left");
    await family.getByRole("button", { name: /add family note/i }).click();
    // Read-your-own-write, offline: the note is visible instantly (own notes read
    // live from the account doc — no server round-trip, no projection wait).
    await expect(family.getByText("on every Feather, keep the head left")).toBeVisible({
      timeout: 15_000,
    });
    // Durability barrier: wait for the note to actually reach the account doc's
    // IndexedDB copy (persistNow is fire-and-forget) before reloading, else the
    // reload could race the async write and lose it.
    await waitForPersistedGrowth(coach.page, `account:${COACH}`, accountBytesBefore);

    // ── Offline RELOAD: the note must survive from local (IndexedDB) persistence ─
    await coach.page.reload();
    // A reopened routine lands in READ mode, which renders from the REST snapshot
    // (zero-socket) — unreachable offline. Switch to LIST view once to upgrade to
    // the live store, which hydrates the routine's Feather from IndexedDB (the
    // read/edit split, mirroring offline-editing's list-view reload path). The
    // account doc rehydrates independently via useAccount.
    await coach.page.getByRole("button", { name: /list view/i }).click();
    await expect(coach.page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
    await openFeatherDetailFromReading(coach.page);
    const familyAfter = coach.page.getByRole("region", { name: /family notes/i });
    await expect(familyAfter.getByText("on every Feather, keep the head left")).toBeVisible({
      timeout: 15_000,
    });

    // ── Reconnect: replay to the DO; the note stays, exactly once ─────────────
    await coachNet.goOnline();
    // Idempotent replay: the note appears exactly ONCE (no duplicate from the
    // reconnect resend) — the account doc reuses its noteId, so the projection
    // upsert never forks it into two rows. Scoped to the family-notes region: the
    // same note now ALSO renders in the reading-view timeline margin (by design),
    // so a page-wide count would legitimately be >1 across surfaces; counting
    // within one surface is what proves the data wasn't duplicated.
    await expect(familyAfter.getByText("on every Feather, keep the head left")).toHaveCount(1, {
      timeout: 30_000,
    });

    await closeUsers(coach);
  });

  test("a bookmark added OFFLINE shows immediately and round-trips to /api/figures/mine after reconnect", async ({
    browser,
  }) => {
    // The reconnect replay + alarm projection is eventually consistent (a capped
    // backoff reconnect, then the DO alarm cadence), so this journey needs more
    // than the default 30s per-test budget for its final /mine poll.
    test.setTimeout(90_000);
    // Intent (WEP-0002 ship gate #2): a library bookmark is now a CRDT edit to
    //   the account doc (`libraryFigureRefs`). Added offline it is idempotently
    //   applied to the hydrated doc and reflected instantly from the live
    //   self-read (the catalog "already in My figures" verdict is derived from
    //   the doc, not a server round-trip). On reconnect the DO alarm projects it
    //   into `library_entry`, so `GET /api/figures/mine` returns it — the D1 row
    //   is re-derived from the doc, the projection inversion working end to end.
    const isWebKit = test.info().project.name === "mobile-safari";
    const [solo] = await openTwoUsers(browser, COACH, STUDENT);
    const soloNet = await installOfflineControl(solo.context, isWebKit);

    await resetDb(solo.page);
    await seedDb(solo.page, {
      users: [{ id: COACH, displayName: "Coach", identityColor: "#111111" }],
    });
    await seedAuth(solo.page, COACH);
    await solo.page.goto("/");

    // Open the Library so the account doc (the bookmark set's home) hydrates its
    // DocConnection while online, BEFORE we drop the network.
    await solo.page.getByRole("button", { name: "Library" }).click();
    await solo.page
      .getByRole("group", { name: /filter by dance/i })
      .getByRole("button", { name: /^foxtrot$/i })
      .click();
    // Two DISTINCT catalog figures, targeted by their per-figure Save aria-label
    // (`Save <name> to My figures`) so the online vs offline bookmark are provably
    // different refs — index-based nth() would drift as saved cards re-render.
    const saveFeather = solo.page.getByRole("button", { name: "Save Feather Step to My figures" });
    const saveThree = solo.page.getByRole("button", { name: "Save Three Step to My figures" });
    await expect(saveFeather).toBeVisible({ timeout: 15_000 });
    await expect(saveThree).toBeVisible({ timeout: 15_000 });

    // Prove + establish the ONLINE path first: a save through the account-doc seam
    // is instantly acknowledged, AND it persists the account doc to IndexedDB — the
    // durability barrier that makes the offline bookmark below survive. (If the
    // account store were idle the save would take the REST shim and never persist,
    // so this wait doubles as an assertion that the seam — not the shim — ran.)
    await saveFeather.click();
    await expect(solo.page.getByText(/saved to My figures/i).last()).toBeVisible({
      timeout: 15_000,
    });
    await waitForDocPersisted(solo.page, `account:${COACH}`);
    // Wait for the toast to auto-dismiss so the offline toast below is unambiguous.
    await expect(solo.page.getByText(/saved to My figures/i)).toHaveCount(0, { timeout: 15_000 });
    const accountBytesBefore = await persistedByteLength(solo.page, `account:${COACH}`);

    // ── Offline: bookmark a DIFFERENT catalog figure (Three Step) ────────────
    await soloNet.goOffline();
    await saveThree.click();
    // Read-your-own-write, offline: the save is acknowledged instantly (the
    // account-doc self-read decides "saved" vs "already", no server needed).
    await expect(solo.page.getByText(/saved to My figures/i).last()).toBeVisible({
      timeout: 15_000,
    });
    await expect(solo.page.getByText(/saved to My figures/i)).toHaveCount(0, { timeout: 15_000 });
    // Idempotence is doc-derived even offline: re-saving the same figure is a gentle
    // "already in My figures", proving the offline bookmark landed in the doc.
    await saveThree.click();
    await expect(solo.page.getByText(/already in My figures/i).last()).toBeVisible({
      timeout: 15_000,
    });
    // Durability barrier: the offline bookmark reached the account doc's IndexedDB
    // copy (persistNow is fire-and-forget) before we exercise the reconnect.
    await waitForPersistedGrowth(solo.page, `account:${COACH}`, accountBytesBefore);

    // ── Reconnect: the DO alarm projects the bookmark to library_entry, so
    //    GET /api/figures/mine round-trips it. Poll /mine until BOTH bookmarks
    //    land — specifically the offline-added Three Step (a Foxtrot catalog ref).
    await soloNet.goOnline();
    const token = await mintTestJWT(COACH);
    await expect
      .poll(
        async () => {
          const res = await solo.page.request.get("/api/figures/mine", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok()) return [];
          const body: { figures: { docRef: string; title: string }[] } = await res.json();
          return body.figures.map((f) => f.title);
        },
        { timeout: 60_000 },
      )
      // The OFFLINE bookmark (Three Step) round-tripped through the projection.
      .toContain("Three Step");

    await closeUsers(solo);
  });

  test("visibility unchanged: a co-member sees the family note on the matching figure; a non-member does not", async ({
    browser,
  }) => {
    // Intent (WEP-0002 ship gate #3): the projection inversion must not change
    //   who can SEE a family note. A co-member still discovers the coach's note
    //   via the D1 index + the routine's co-membership gate (Q-FIGNOTE-VIS option
    //   2), now that the D1 row is an alarm-written projection of the coach's
    //   account doc rather than a direct insert. A non-member is refused — never
    //   reads another user's account doc, and the routine's family-notes read
    //   itself 403s before any note is returned.
    const [coach, student] = await openTwoUsers(browser, COACH, STUDENT);

    await resetDb(coach.page);
    await seedDb(coach.page, {
      users: [
        { id: COACH, displayName: "Coach", identityColor: "#111111" },
        { id: STUDENT, displayName: "Student", identityColor: "#222222" },
        { id: STRANGER, displayName: "Stranger", identityColor: "#333333" },
      ],
    });
    await seedAuth(coach.page, COACH);
    await seedAuth(student.page, STUDENT);
    await coach.page.goto("/");

    // Coach builds a shared Foxtrot with a Feather, then shares it with the student.
    const docRef = await createFoxtrotRoutine(coach.page, "Shared Family Foxtrot");
    await addFeatherStep(coach.page);
    await seedDb(coach.page, {
      memberships: [{ docRef, userId: STUDENT, role: "editor" }],
    });

    // Coach authors an all-dances family note on the Feather family (online — the
    // DO alarm projects it to figure_type_note_index for the co-member read).
    await openFeatherDetailFromReading(coach.page);
    const family = coach.page.getByRole("region", { name: /family notes/i });
    await family.getByRole("button", { name: /this figure family/i }).click();
    await family.getByRole("radio", { name: /all dances/i }).click();
    await family.getByRole("textbox", { name: /family note/i }).fill("rise later on this family");
    await family.getByRole("button", { name: /add family note/i }).click();
    await expect(family.getByText("rise later on this family")).toBeVisible({ timeout: 15_000 });

    // ── The CO-MEMBER sees it on the matching figure ─────────────────────────
    // The student opens the shared routine's reading lens and the Feather detail;
    // the coach's note surfaces via the co-membership-gated read. Poll the reload
    // so the alarm projection is caught (eventually consistent, alarm-cadence).
    await expect(async () => {
      await student.page.goto(`/routines/${docRef}`);
      await openFeatherDetailFromReading(student.page);
      await expect(
        student.page
          .getByRole("region", { name: /family notes/i })
          .getByText("rise later on this family"),
      ).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });

    // ── A NON-MEMBER does not ────────────────────────────────────────────────
    // The co-membership gate is the security boundary: an authenticated user with
    // no access to the routine is refused BEFORE any note is read (403), so the
    // note is never surfaced to them.
    const strangerToken = await mintTestJWT(STRANGER);
    const denied = await coach.page.request.get(
      `/api/routines/${encodeURIComponent(docRef)}/family-notes`,
      { headers: { Authorization: `Bearer ${strangerToken}` } },
    );
    expect(denied.status(), "a non-member's family-notes read is forbidden").toBe(403);

    await closeUsers(coach, student);
  });
});
