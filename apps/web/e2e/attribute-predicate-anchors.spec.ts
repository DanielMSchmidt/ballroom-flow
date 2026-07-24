import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";
import { mintTestJWT } from "./support/jwt";
import { closeUsers, openTwoUsers } from "./support/two-users";

// ─────────────────────────────────────────────────────────────────────────
// attribute-predicate annotation anchors — ship gate (docs/concepts/annotations.md
// § Anchors — what a note points at; docs/system/architecture.md § D1 — the index
// & projections). Runs against the REAL worker (D1 + per-document Durable Objects +
// the attribute_predicate_note_index alarm projection + the co-membership-gated read)
// via the #191 harness — no live Clerk, a real test JWT, the real DO alarm.
//
// Three journeys (from the idea's ship gate):
//   1. Surfaces across choreos — author "soften every left sway" scoped to the dance;
//      the note surfaces on every left-sway step across two of their choreos.
//   2. Dynamic re-resolution — the note surfaces only where a step matches; the read
//      re-evaluates matchPredicate on each render (no precomputed step-id set).
//   3. Co-member sees, non-member blocked — a co-member sees the note on the shared
//      routine; a signed-in non-member sees nothing via UI OR a direct index read (403).
//
// @smoke — part of the CI PR smoke subset (this journey is the feature's PR gate).
// ─────────────────────────────────────────────────────────────────────────

const COACH = "user_pred_coach";
const STUDENT = "user_pred_student";
const STRANGER = "user_pred_stranger";

/** A Waltz figure carrying a left sway (to_L) on count 2 and a right sway on count 1. */
function swayAttributes() {
  return [
    { id: "ps1", kind: "sway", count: 1, role: null, value: "to_R" },
    { id: "ps2", kind: "sway", count: 2, role: null, value: "to_L" },
  ];
}

test.describe("@smoke attribute-predicate anchors", () => {
  test("author a dance-scoped 'soften every left sway' → surfaces on the matching step across two choreos", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const FIG_A = `fig_pred_a_${run}`;
    const FIG_B = `fig_pred_b_${run}`;
    const RT_A = `rt_pred_a_${run}`;
    const RT_B = `rt_pred_b_${run}`;
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: COACH, displayName: "Coach", identityColor: "#c0563f" }],
      figures: [
        {
          docRef: FIG_A,
          scope: "global",
          ownerId: "app",
          figureType: "whisk",
          dance: "waltz",
          name: "Whisk",
          attributes: swayAttributes(),
        },
        {
          docRef: FIG_B,
          scope: "global",
          ownerId: "app",
          figureType: "chasse",
          dance: "waltz",
          name: "Chassé",
          attributes: swayAttributes(),
        },
      ],
      docs: [
        {
          docRef: RT_A,
          type: "routine",
          ownerId: COACH,
          title: "Waltz A",
          dance: "waltz",
          sections: [{ id: "sa", name: "Intro", placements: [{ id: "pa1", figureRef: FIG_A }] }],
        },
        {
          docRef: RT_B,
          type: "routine",
          ownerId: COACH,
          title: "Waltz B",
          dance: "waltz",
          sections: [{ id: "sb", name: "Intro", placements: [{ id: "pb1", figureRef: FIG_B }] }],
        },
      ],
      memberships: [
        { docRef: RT_A, userId: COACH, role: "editor" },
        { docRef: RT_B, userId: COACH, role: "editor" },
      ],
      placementEdges: [
        { routineRef: RT_A, figureRef: FIG_A },
        { routineRef: RT_B, figureRef: FIG_B },
      ],
    });
    await seedAuth(page, COACH);
    await page.goto("/");

    // Author the predicate note through the Journal link picker.
    const nav = page.getByRole("navigation", { name: /primary navigation|tab bar/i });
    await nav.getByRole("button", { name: "Journal" }).click();
    await page.getByRole("button", { name: "New entry", exact: true }).click();
    await page.getByLabel("entry text").fill("soften every left sway");
    await page.getByText(/link to a step, figure or attribute/i).click();
    await expect(page.getByText("Which choreo?")).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Waltz A/ })
      .click();
    // Target step → the attribute path.
    await page.getByText("An attribute").click();
    await page.getByText("Sway", { exact: true }).click();
    await page.getByText("to_L", { exact: true }).click();
    // Both role (the default) → advance to scope via the role step's done (scoped
    // to the picker dialog so it never matches the editor header's "done").
    const roleStep = page.getByRole("dialog", { name: "Which side?" });
    await roleStep.getByRole("button", { name: /^done$/i }).click();
    await page.getByText(/All my Waltz choreos|All my waltz choreos/).click();
    // The entry editor's header "done" saves the predicate note (through the account
    // store) and closes the editor. A predicate note is a `note`-kind account
    // annotation, NOT a lesson/practice journal entry, so it does not appear in the
    // journal list — the editor closing back to the Journal heading is the signal.
    await page.getByRole("button", { name: "done", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Journal", level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByLabel("entry text")).toBeHidden();

    // The note surfaces on the left-sway step (count 2) in BOTH Waltz choreos' reading views.
    for (const rt of [RT_A, RT_B]) {
      await page.goto(`/routines/${rt}`);
      const row2 = page
        .getByTestId("reading-view")
        .getByRole("button", { name: /notes — count 2/i });
      await expect(row2).toContainText("soften every left sway", { timeout: 15_000 });
      // The right-sway step (count 1) does NOT carry the note.
      const row1 = page
        .getByTestId("reading-view")
        .getByRole("button", { name: /notes — count 1/i });
      await expect(row1).not.toContainText("soften every left sway");
    }
  });

  test("a co-member sees the note on the shared routine; a non-member sees nothing (UI + 403)", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const FIG = `fig_pred_shared_${run}`;
    const RT = `rt_pred_shared_${run}`;
    const [coach, student] = await openTwoUsers(browser, COACH, STUDENT);
    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();

    await resetDb(coach.page);
    await seedDb(coach.page, {
      users: [
        { id: COACH, displayName: "Coach", identityColor: "#c0563f" },
        { id: STUDENT, displayName: "Student", identityColor: "#1f8a5b" },
        { id: STRANGER, displayName: "Stranger", identityColor: "#5b6b8a" },
      ],
      figures: [
        {
          docRef: FIG,
          scope: "global",
          ownerId: "app",
          figureType: "whisk",
          dance: "waltz",
          name: "Whisk",
          attributes: swayAttributes(),
        },
      ],
      docs: [
        {
          docRef: RT,
          type: "routine",
          ownerId: COACH,
          title: "Shared Waltz",
          dance: "waltz",
          sections: [{ id: "ss", name: "Intro", placements: [{ id: "ps1", figureRef: FIG }] }],
        },
      ],
      memberships: [
        { docRef: RT, userId: COACH, role: "editor" },
        { docRef: RT, userId: STUDENT, role: "commenter" },
      ],
      placementEdges: [{ routineRef: RT, figureRef: FIG }],
    });
    await seedAuth(coach.page, COACH);
    await seedAuth(student.page, STUDENT);
    await seedAuth(strangerPage, STRANGER);

    // Coach authors the predicate note.
    await coach.page.goto("/");
    const nav = coach.page.getByRole("navigation", { name: /primary navigation|tab bar/i });
    await nav.getByRole("button", { name: "Journal" }).click();
    await coach.page.getByRole("button", { name: "New entry", exact: true }).click();
    await coach.page.getByLabel("entry text").fill("soften every left sway");
    await coach.page.getByText(/link to a step, figure or attribute/i).click();
    await expect(coach.page.getByText("Which choreo?")).toBeVisible({ timeout: 15_000 });
    await coach.page
      .getByRole("dialog")
      .getByRole("button", { name: /Shared Waltz/ })
      .click();
    await coach.page.getByText("An attribute").click();
    await coach.page.getByText("Sway", { exact: true }).click();
    await coach.page.getByText("to_L", { exact: true }).click();
    await coach.page
      .getByRole("dialog", { name: "Which side?" })
      .getByRole("button", { name: /^done$/i })
      .click();
    await coach.page.getByText(/All my Waltz choreos|All my waltz choreos/).click();
    await coach.page.getByRole("button", { name: "done", exact: true }).click();
    await expect(coach.page.getByRole("heading", { name: "Journal", level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(coach.page.getByLabel("entry text")).toBeHidden();

    // The co-member (student) sees the note on the shared routine's matching step.
    await student.page.goto(`/routines/${RT}`);
    const studentRow = student.page
      .getByTestId("reading-view")
      .getByRole("button", { name: /notes — count 2/i });
    await expect(studentRow).toContainText("soften every left sway", { timeout: 20_000 });

    // The non-member (stranger) sees nothing in the UI…
    await strangerPage.goto(`/routines/${RT}`);
    await expect(strangerPage.getByText("soften every left sway")).toBeHidden({ timeout: 15_000 });
    // …and a DIRECT index read, AUTHENTICATED as the stranger, is refused (403) —
    // the co-membership gate holds (a bare unauthenticated request would only 401).
    const strangerToken = await mintTestJWT(STRANGER);
    const res = await strangerPage.request.get(`/api/routines/${RT}/predicate-notes`, {
      headers: { Authorization: `Bearer ${strangerToken}` },
    });
    expect(res.status()).toBe(403);

    await closeUsers(coach, student);
    await stranger.close();
  });

  test("@smoke edit-after-authoring: retagging a matching step's sway drops the predicate note (issue #284)", async ({
    page,
  }) => {
    // Regression (issue #284): the feature's headline dynamic promise — "retag or
    // remove it and the note drops — all on read". The original ship gate never
    // edited notation after authoring, so this re-evaluation path shipped broken.
    // Here: author a `to_L` note (surfaces on count 2), then edit that step's sway
    // left → right in the figure editor (a copy-on-write variant), and assert the
    // note DROPS from count 2 in the reading view — matched over the RESOLVED
    // variant timeline, exactly as a dancer would see it.
    test.setTimeout(120_000);
    const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const FIG = `fig_pred_edit_${run}`;
    const RT = `rt_pred_edit_${run}`;
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: COACH, displayName: "Coach", identityColor: "#c0563f" }],
      figures: [
        {
          docRef: FIG,
          scope: "global",
          ownerId: "app",
          figureType: "whisk",
          dance: "waltz",
          name: "Whisk",
          attributes: swayAttributes(),
        },
      ],
      docs: [
        {
          docRef: RT,
          type: "routine",
          ownerId: COACH,
          title: "Edit Waltz",
          dance: "waltz",
          sections: [{ id: "se", name: "Intro", placements: [{ id: "pe1", figureRef: FIG }] }],
        },
      ],
      memberships: [{ docRef: RT, userId: COACH, role: "editor" }],
      placementEdges: [{ routineRef: RT, figureRef: FIG }],
    });
    await seedAuth(page, COACH);
    await page.goto("/");

    // Author the dance-scoped `to_L` note through the Journal link picker.
    const nav = page.getByRole("navigation", { name: /primary navigation|tab bar/i });
    await nav.getByRole("button", { name: "Journal" }).click();
    await page.getByRole("button", { name: "New entry", exact: true }).click();
    await page.getByLabel("entry text").fill("soften every left sway");
    await page.getByText(/link to a step, figure or attribute/i).click();
    await expect(page.getByText("Which choreo?")).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Edit Waltz/ })
      .click();
    await page.getByText("An attribute").click();
    await page.getByText("Sway", { exact: true }).click();
    await page.getByText("to_L", { exact: true }).click();
    await page
      .getByRole("dialog", { name: "Which side?" })
      .getByRole("button", { name: /^done$/i })
      .click();
    await page.getByText(/All my Waltz choreos|All my waltz choreos/).click();
    await page.getByRole("button", { name: "done", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Journal", level: 1 })).toBeVisible({
      timeout: 30_000,
    });

    // Before the edit: the note surfaces on count 2 (the left sway) only.
    await page.goto(`/routines/${RT}`);
    const readingRow2 = () =>
      page.getByTestId("reading-view").getByRole("button", { name: /notes — count 2/i });
    await expect(readingRow2()).toContainText("soften every left sway", { timeout: 15_000 });

    // Edit the Whisk's sway at count 2 from LEFT → RIGHT. Opening an existing
    // routine lands in READ; switch to EDIT to reach the step timeline editor.
    await page.getByRole("button", { name: /list view/i }).click();
    await page.getByRole("button", { name: /edit steps: Whisk/i }).click();
    await page.getByRole("button", { name: /^Edit Sway at count 2$/i }).click();
    // The sway value chips read as full labels ("Sway right" / "Sway left").
    // Selecting the value auto-saves (onChange) — which for a global figure spawns
    // a copy-on-write variant, re-rendering the editor into its "making this figure
    // yours" pending state (so we don't race a now-detaching "Done" button).
    await page.getByRole("button", { name: /^Sway right$/ }).click();
    await expect(page.getByText(/made this figure yours/i).first()).toBeVisible({
      timeout: 15_000,
    });
    // Wait until the async copy-on-write COMPLETES (POST /api/figures + the
    // placement re-point synced to the routine DO) before reloading — the
    // divergence-derived "Custom" badge is the observable that the re-point landed,
    // so a reload sees the variant, not the still-base placement (a sync race).
    await expect(page.getByText(/^Custom$/)).toBeVisible({ timeout: 15_000 });

    // Back in the reading view. The edit was a sway write, which stores leader
    // `to_R` + follower `to_L` (the same physical lean — sway MIRRORS, WEP-0008).
    // Predicate matching now respects the ACTIVE ROLE LENS, so the note tracks the
    // side that actually shows a left sway. Pin the lens deterministically via its
    // persisted key (`bb_role`) so the assertions don't depend on a stored default.
    const setLens = (lens: "leader" | "follower") =>
      page.addInitScript((v) => window.localStorage.setItem("bb_role", v), lens);

    // LEADER lens (the QA repro's view): count 2 renders the leader's RIGHT sway.
    // A full reload (via about:blank) makes the init-script's `bb_role` take on a
    // fresh mount — an SPA route change wouldn't re-read the persisted lens.
    await setLens("leader");
    await page.goto("about:blank");
    await page.goto(`/routines/${RT}`);
    const reading = page.getByTestId("reading-view");
    await expect(reading.getByRole("button", { name: /^About Sway — R$/ })).toHaveCount(2, {
      timeout: 20_000,
    });
    // The regression assertion (issue #284): under the leader lens NO left sway is
    // shown, so the `to_L` note drops from count 2 and surfaces nowhere.
    await expect(readingRow2()).not.toContainText("soften every left sway");
    await expect(page.getByText("soften every left sway")).toBeHidden();

    // FOLLOWER lens: the follower still sways LEFT on count 2 (the mirror), so the
    // note correctly surfaces there — matching what that dancer actually sees.
    await setLens("follower");
    await page.goto("about:blank");
    await page.goto(`/routines/${RT}`);
    await expect(reading.getByRole("button", { name: /^About Sway — L$/ })).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(readingRow2()).toContainText("soften every left sway");
  });
});
