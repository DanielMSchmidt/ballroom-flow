import { expect, type Page, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Context-first note capture ship gate (docs/concepts/annotations.md § The Journal
// note flow is scope-first; § Voice capture grounds within the selected dance).
// Runs against the REAL worker via the #191 harness with the fixture voice AI
// (no `AI` binding). Playwright cannot produce mic input, so the transcript is
// injected via window.__weaveVoiceTranscript before capture (as in
// voice-notes.spec.ts).
//
// Two scenarios (idea doc § Ship gate):
//   1 — pick a DANCE → hold-to-talk → the proposal lands on a figure FROM THAT
//       DANCE (the Foxtrot Feather), not the sibling Waltz figure.
//   2 — a dance with NO annotate-capable choreo shows the actionable empty state
//       ("add a figure to a 〈dance〉 choreo first"), NOT "couldn't connect", and
//       blocks capture (no mic to hold).
//
// @smoke — the scope-first fixture path IS the core path in CI.
// ─────────────────────────────────────────────────────────────────────────

const USER = "user_ctxnote";

function runId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** A Foxtrot routine placing a Feather + a Waltz routine placing a Whisk. */
async function seedFoxtrotAndWaltz(page: Page): Promise<void> {
  const run = runId();
  const FEATHER = `fig_ctx_feather_${run}`;
  const WHISK = `fig_ctx_whisk_${run}`;
  const RT_FOX = `rt_ctx_fox_${run}`;
  const RT_WALTZ = `rt_ctx_waltz_${run}`;
  await resetDb(page);
  await seedDb(page, {
    users: [{ id: USER, displayName: "Dani", identityColor: "#1f8a5b" }],
    figures: [
      {
        docRef: FEATHER,
        scope: "global",
        ownerId: "app",
        figureType: "feather",
        dance: "foxtrot",
        name: "Feather Step",
        attributes: [{ id: "af1", kind: "footwork", count: 1, role: null, value: "HT" }],
      },
      {
        docRef: WHISK,
        scope: "global",
        ownerId: "app",
        figureType: "whisk",
        dance: "waltz",
        name: "Whisk",
        attributes: [{ id: "aw1", kind: "footwork", count: 1, role: null, value: "HT" }],
      },
    ],
    docs: [
      {
        docRef: RT_FOX,
        type: "routine",
        ownerId: USER,
        title: "Comp Slowfox",
        dance: "foxtrot",
        sections: [{ id: "sf", name: "Intro", placements: [{ id: "pf1", figureRef: FEATHER }] }],
      },
      {
        docRef: RT_WALTZ,
        type: "routine",
        ownerId: USER,
        title: "Gold Waltz",
        dance: "waltz",
        sections: [{ id: "sw", name: "Intro", placements: [{ id: "pw1", figureRef: WHISK }] }],
      },
    ],
    memberships: [
      { docRef: RT_FOX, userId: USER, role: "editor" },
      { docRef: RT_WALTZ, userId: USER, role: "editor" },
    ],
    placementEdges: [
      { routineRef: RT_FOX, figureRef: FEATHER },
      { routineRef: RT_WALTZ, figureRef: WHISK },
    ],
  });
  await seedAuth(page, USER);
}

/** Open the Journal entry editor and pick a dance scope chip. */
async function openEditorAndScope(page: Page, danceLabel: string): Promise<void> {
  const nav = page.getByRole("navigation", { name: /primary navigation|tab bar/i });
  await nav.getByRole("button", { name: "Journal" }).click();
  await page.getByRole("button", { name: "New entry", exact: true }).click();
  await page.getByRole("button", { name: danceLabel, exact: true }).click();
}

/** Drive push-to-talk with an injected transcript (Playwright has no mic). */
async function holdToTalk(page: Page, transcript: string): Promise<void> {
  await page.evaluate((t) => {
    window.__weaveVoiceTranscript = t;
  }, transcript);
  await page.getByRole("button", { name: "voice", exact: true }).click();
  const handle = await page.getByRole("button", { name: /hold to talk/i }).elementHandle();
  if (handle) {
    await handle.dispatchEvent("pointerdown");
    await handle.dispatchEvent("pointerup").catch(() => {});
  }
}

test.describe("@smoke context-first note capture (fixture AI)", () => {
  test("pick a dance → voice proposal lands on a figure from THAT dance", async ({ page }) => {
    test.setTimeout(120_000);
    await seedFoxtrotAndWaltz(page);
    await page.goto("/");

    // Scope to Foxtrot, then speak a Feather note (no dance named in the words —
    // the grounding comes from the SCOPE, so only the Foxtrot Feather is in
    // context; the sibling Waltz Whisk is filtered out server-side).
    await openEditorAndScope(page, "Foxtrot");
    await holdToTalk(page, "In Feather Steps, I need to settle the sway.");

    // Grounded within Foxtrot → a Feather family proposal (from that dance).
    await expect(page.getByText("Here's what I heard")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/↳ all Feathers/)).toBeVisible();
    await page.getByText("Confirm & save").click();
    await expect(page.getByText(/↳ all Feathers/)).toBeVisible();
    await page.getByRole("button", { name: /^done$/i }).click();
    await expect(page.getByRole("list", { name: /journal entries/i })).toBeVisible({
      timeout: 15_000,
    });
    // The addressing-stripped coaching content is the entry text.
    await expect(page.getByText("I need to settle the sway.", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("a dance with no choreo shows the actionable empty state, not 'couldn't connect'", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await seedFoxtrotAndWaltz(page);
    await page.goto("/");

    // Scope to Tango — the user has no Tango choreo.
    await openEditorAndScope(page, "Tango");
    // The editor already surfaces the honest, actionable hint.
    await expect(page.getByText(/add a figure to a tango choreo first/i)).toBeVisible();

    // Opening voice shows the actionable state (in the sheet) and NO mic (capture
    // blocked); it never reaches the unresolved "couldn't find a target" copy.
    await page.getByRole("button", { name: "voice", exact: true }).click();
    await expect(
      page.getByRole("dialog").getByText(/add a figure to a tango choreo first/i),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /hold to talk/i })).toBeHidden();
    await expect(page.getByText("Couldn't find a target")).toBeHidden();
  });
});
