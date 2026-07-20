import { expect, type Page, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// AI voice notes ship gate (docs/concepts/annotations.md § The Journal). Runs
// against the REAL worker (D1 + per-document DOs) via the #191 harness with the
// [env.e2e] config: NO `AI` binding + E2E_TEST_ROUTES=1 ⇒ voiceAiFor serves the
// DETERMINISTIC fixture seam (zero secrets). Playwright cannot produce mic input,
// so the transcript is injected via window.__weaveVoiceTranscript before the
// sheet opens (the compile-time-gated E2E hook in lib/speech.ts).
//
// Three scenarios (idea doc § Test plan):
//   A — "In Slowfox, in Feather Steps, …" → a figureType/foxtrot family note that
//       surfaces on the Feather in the OTHER Foxtrot routine.
//   B — "…on the first bounce fallaway…" → a `figure` anchor on the EARLIEST of
//       two distinct Bounce Fallaway figure docs; present on instance 1 only.
//   C — "Remember to breathe…" → unresolved: transcript kept as note text, no
//       anchor (never a wrong anchor).
//
// @smoke — the fixture path IS the core path in CI.
// ─────────────────────────────────────────────────────────────────────────

const USER = "user_voice";

function runId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Two Foxtrot routines sharing one catalog Feather (scenario A / C seed). */
async function seedTwoFoxtrotRoutines(
  page: Page,
): Promise<{ FEATHER: string; RT_A: string; RT_B: string }> {
  const run = runId();
  const FEATHER = `fig_voice_feather_${run}`;
  const RT_A = `rt_voice_a_${run}`;
  const RT_B = `rt_voice_b_${run}`;
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
        attributes: [
          { id: "af1", kind: "footwork", count: 1, role: null, value: "HT" },
          { id: "af2", kind: "footwork", count: 2, role: null, value: "T" },
          { id: "af3", kind: "footwork", count: 3, role: null, value: "TH" },
        ],
      },
    ],
    docs: [
      {
        docRef: RT_A,
        type: "routine",
        ownerId: USER,
        title: "Foxtrot A",
        dance: "foxtrot",
        sections: [
          { id: "sec_a", name: "Intro", placements: [{ id: "pl_a1", figureRef: FEATHER }] },
        ],
      },
      {
        docRef: RT_B,
        type: "routine",
        ownerId: USER,
        title: "Foxtrot B",
        dance: "foxtrot",
        sections: [
          { id: "sec_b", name: "Intro", placements: [{ id: "pl_b1", figureRef: FEATHER }] },
        ],
      },
    ],
    memberships: [
      { docRef: RT_A, userId: USER, role: "editor" },
      { docRef: RT_B, userId: USER, role: "editor" },
    ],
    placementEdges: [
      { routineRef: RT_A, figureRef: FEATHER },
      { routineRef: RT_B, figureRef: FEATHER },
    ],
  });
  await seedAuth(page, USER);
  return { FEATHER, RT_A, RT_B };
}

/** One "Comp Slowfox" placing TWO distinct Bounce Fallaway docs (scenario B).
 *  A `figure` anchor names a figure DOC, so instance-level resolution needs
 *  distinct docs — seed them so. */
async function seedCompSlowfox(
  page: Page,
): Promise<{ BOUNCE_1: string; BOUNCE_2: string; RT: string }> {
  const run = runId();
  const BOUNCE_1 = `fig_voice_bounce1_${run}`;
  const BOUNCE_2 = `fig_voice_bounce2_${run}`;
  const RT = `rt_voice_comp_${run}`;
  await resetDb(page);
  const bounce = (docRef: string) => ({
    docRef,
    scope: "account" as const,
    ownerId: USER,
    figureType: "bounce_fallaway",
    dance: "foxtrot",
    name: "Bounce Fallaway",
    attributes: [{ id: "ab1", kind: "footwork", count: 1, role: null, value: "flat" }],
  });
  await seedDb(page, {
    users: [{ id: USER, displayName: "Dani", identityColor: "#1f8a5b" }],
    figures: [bounce(BOUNCE_1), bounce(BOUNCE_2)],
    docs: [
      {
        docRef: RT,
        type: "routine",
        ownerId: USER,
        title: "Comp Slowfox",
        dance: "foxtrot",
        sections: [
          {
            id: "sec_c",
            name: "Intro",
            placements: [
              { id: "pl_c1", figureRef: BOUNCE_1 },
              { id: "pl_c2", figureRef: BOUNCE_2 },
            ],
          },
        ],
      },
    ],
    memberships: [{ docRef: RT, userId: USER, role: "editor" }],
    placementEdges: [
      { routineRef: RT, figureRef: BOUNCE_1 },
      { routineRef: RT, figureRef: BOUNCE_2 },
    ],
  });
  await seedAuth(page, USER);
  return { BOUNCE_1, BOUNCE_2, RT };
}

/** Open the journal entry editor and drive push-to-talk voice capture with an
 *  injected transcript. The sheet opens IDLE (push-to-talk, #291); pressing the talk
 *  button starts the E2E capture, which emits the injected transcript as final on
 *  `start` (Playwright has no mic); releasing completes the hold. */
async function startVoiceWithTranscript(page: Page, transcript: string): Promise<void> {
  const nav = page.getByRole("navigation", { name: /primary navigation|tab bar/i });
  await nav.getByRole("button", { name: "Journal" }).click();
  await page.getByRole("button", { name: "New entry", exact: true }).click();
  // Inject the transcript the fixture capture will emit (Playwright has no mic).
  await page.evaluate((t) => {
    window.__weaveVoiceTranscript = t;
  }, transcript);
  await page.getByRole("button", { name: "voice", exact: true }).click();
  // Press-and-hold the mic (pointerdown starts capture → the injected transcript),
  // then release.
  const talk = page.getByRole("button", { name: /hold to talk|recording — release to send/i });
  await talk.dispatchEvent("pointerdown");
  await talk.dispatchEvent("pointerup");
}

test.describe("@smoke AI voice notes (fixture AI)", () => {
  test("scenario A — a Feather sway note surfaces on the sibling Foxtrot routine", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { RT_B } = await seedTwoFoxtrotRoutines(page);
    await page.goto("/");

    await startVoiceWithTranscript(
      page,
      "In Slowfox, in Feather Steps, I need to settle the sway before the Three Step.",
    );
    // The fixture resolves a figureType/foxtrot proposal → the confirm state.
    await expect(page.getByText("Here's what I heard")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("high confidence")).toBeVisible();
    await expect(page.getByText(/↳ all Feathers · all Foxtrot/)).toBeVisible();
    await page.getByText("Confirm & save").click();
    // The confirmed proposal is now an ordinary link chip; Done saves it.
    await expect(page.getByText(/↳ all Feathers · all Foxtrot/)).toBeVisible();
    await page.getByRole("button", { name: /^done$/i }).click();

    // The family note surfaces on the Feather in the OTHER Foxtrot routine.
    await expect(page.getByRole("list", { name: /journal entries/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.goto(`/routines/${RT_B}`);
    await page
      .getByTestId("reading-view")
      .getByRole("button", { name: "Feather Step", exact: true })
      .click();
    const familyNotes = page.getByRole("region", { name: /family notes/i });
    await expect(familyNotes.getByText("Settle the sway before the Three Step.")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("scenario B — an ordinal bounce fallaway note lands on the first instance only", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { RT } = await seedCompSlowfox(page);
    await page.goto("/");

    await startVoiceWithTranscript(
      page,
      "In my competition slowfox, on the first bounce fallaway, I need to change the direction to go more diagonal.",
    );
    await expect(page.getByText("Here's what I heard")).toBeVisible({ timeout: 15_000 });
    // The proposal is a figure anchor labelled with the first instance's choreo.
    await expect(page.getByText(/↳ Bounce Fallaway · Comp Slowfox/)).toBeVisible();
    await page.getByText("Confirm & save").click();
    await page.getByRole("button", { name: /^done$/i }).click();
    await expect(page.getByRole("list", { name: /journal entries/i })).toBeVisible({
      timeout: 30_000,
    });

    // The annotation appears on the FIRST Bounce Fallaway only.
    await page.goto(`/routines/${RT}`);
    const bounces = page
      .getByTestId("reading-view")
      .getByRole("button", { name: "Bounce Fallaway", exact: true });
    await bounces.first().click();
    const panel = page.getByRole("region", { name: /^annotations$/i });
    await expect(panel.getByText("Change the direction to go more diagonal.")).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
    // …and NOT on the second instance.
    await bounces.nth(1).click();
    await expect(
      page
        .getByRole("region", { name: /^annotations$/i })
        .getByText("Change the direction to go more diagonal."),
    ).toBeHidden();
  });

  test("scenario C — an unresolved note is kept as text, never a wrong anchor", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await seedTwoFoxtrotRoutines(page);
    await page.goto("/");

    await startVoiceWithTranscript(page, "Remember to breathe and stay grounded.");
    // No figure matched → the unresolved fallback (no proposal chip, no anchor).
    await expect(page.getByText("Couldn't find a target")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/↳/)).toBeHidden();
    await page.getByText("Keep as note text").click();
    // The transcript fills the editor textarea with NO link chip.
    await expect(page.getByLabel("entry text")).toHaveValue(
      "Remember to breathe and stay grounded.",
    );
    await expect(page.getByText(/↳/)).toBeHidden();
  });
});
