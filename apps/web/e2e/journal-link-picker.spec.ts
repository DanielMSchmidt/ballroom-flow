import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// WEP-0004 ship gate — the choreo-first journal link picker (PLAN §4.6).
// Runs against the REAL worker (D1 + per-document DOs) via the #191 harness.
//
// The rushed-Whisk scenario: two Waltz routines share the catalog Whisk.
//   1. choreo → type-ahead figure → placement GRID (count 3) → scope offers
//      NO cross-dance option for a timed note → "All Waltz choreos" saves a
//      TIMED family note that surfaces PINNED (count 3) on the sibling
//      routine's Whisk.
//   2. "The entire figure" → all three scopes → "This choreo only" saves a
//      routine-scoped figure annotation that does NOT leak to the sibling.
//
// @smoke — part of the CI PR smoke subset (the WEP-0004 ship gate).
// ─────────────────────────────────────────────────────────────────────────

const USER = "user_wep4";

/** Seed: one user owning two Waltz routines, both placing the same Whisk.
 *  Doc refs are UNIQUE per invocation: `resetDb` wipes only the D1 index —
 *  Durable Object CRDT state survives — so a reused routine ref would inherit
 *  the previous run's annotations (the same reused-DO-name trap as the worker
 *  harness's `uniqueDocName` rule; seen as duplicate notes under
 *  `--repeat-each`). */
async function seedTwoWaltzRoutines(
  page: import("@playwright/test").Page,
): Promise<{ WHISK: string; RT_A: string; RT_B: string }> {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const WHISK = `fig_wep4_whisk_${run}`;
  const RT_A = `rt_wep4_a_${run}`;
  const RT_B = `rt_wep4_b_${run}`;
  await resetDb(page);
  await seedDb(page, {
    users: [{ id: USER, displayName: "Dani", identityColor: "#1f8a5b" }],
    figures: [
      {
        docRef: WHISK,
        scope: "global",
        ownerId: "app",
        figureType: "whisk",
        dance: "waltz",
        name: "Whisk",
        attributes: [
          { id: "at1", kind: "footwork", count: 1, role: null, value: "HT" },
          { id: "at2", kind: "footwork", count: 2, role: null, value: "T" },
          { id: "at3", kind: "footwork", count: 3, role: null, value: "TH" },
        ],
      },
    ],
    docs: [
      {
        docRef: RT_A,
        type: "routine",
        ownerId: USER,
        title: "Waltz A",
        dance: "waltz",
        sections: [{ id: "sec_a", name: "Intro", placements: [{ id: "pl_a1", figureRef: WHISK }] }],
      },
      {
        docRef: RT_B,
        type: "routine",
        ownerId: USER,
        title: "Waltz B",
        dance: "waltz",
        sections: [{ id: "sec_b", name: "Intro", placements: [{ id: "pl_b1", figureRef: WHISK }] }],
      },
    ],
    memberships: [
      { docRef: RT_A, userId: USER, role: "editor" },
      { docRef: RT_B, userId: USER, role: "editor" },
    ],
    placementEdges: [
      { routineRef: RT_A, figureRef: WHISK },
      { routineRef: RT_B, figureRef: WHISK },
    ],
  });
  await seedAuth(page, USER);
  return { WHISK, RT_A, RT_B };
}

/** Drive the shared front of the picker: new entry → link → Waltz A → Whisk. */
async function openPickerOnWhisk(
  page: import("@playwright/test").Page,
  entryText: string,
): Promise<void> {
  const rail = page.getByRole("navigation", { name: /primary navigation/i });
  await rail.getByRole("button", { name: "Journal" }).click();
  // Exact name: the header's icon button is "New entry"; the empty-state CTA is
  // "+ New entry" — a bare /New entry/i regex matches BOTH when the journal is
  // empty (strict-mode violation, the run's one flake).
  await page.getByRole("button", { name: "New entry", exact: true }).click();
  await page.getByLabel("entry text").fill(entryText);
  await page.getByText(/link to a step, figure or attribute/i).click();
  // CHOREO-FIRST: the picker opens on the user's choreos, no link-type fork.
  await expect(page.getByText("Which choreo?")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Waltz A/ }).click();
  // Type-ahead narrows the CHOREO's figures.
  await page.getByLabel("Search figures").fill("wh");
  await page.getByRole("button", { name: /^Whisk/ }).click();
  // The placement grid renders the figure's attribute chips (detail-view style).
  await expect(page.getByText("Where on Whisk?")).toBeVisible();
  await expect(page.getByText("TH", { exact: true })).toBeVisible();
}

test.describe("@smoke WEP-0004 choreo-first journal links", () => {
  test("a TIMED link (grid count 3 → all Waltz choreos) surfaces pinned on the sibling routine", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { RT_B } = await seedTwoWaltzRoutines(page);
    await page.goto("/");

    await openPickerOnWhisk(page, "settle before the chassé");
    // Pick count 3 from the grid.
    await page.getByRole("button", { name: /^count 3/ }).click();
    // Scope LAST, gated: a timed note never spans dances.
    await expect(page.getByText("All Waltz choreos")).toBeVisible();
    await expect(page.getByText("Every dance")).toBeHidden();
    await page.getByText("All Waltz choreos").click();
    // The chip records family + dance + pinned count; Done saves the entry.
    await expect(page.getByText("↳ all Whisks · all Waltz · count 3")).toBeVisible();
    await page.getByRole("button", { name: /^done$/i }).click();

    // The account-arm journal read returns own family notes directly (no alarm).
    const journalEntries = page.getByRole("list", { name: /journal entries/i });
    await expect(journalEntries.getByText("settle before the chassé")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/↳ all Whisks · all Waltz · count 3/)).toBeVisible();

    // The note surfaces PINNED on the OTHER Waltz routine's Whisk (family
    // notes on the figure detail, read lens).
    await page.goto(`/routines/${RT_B}`);
    await page
      .getByTestId("reading-view")
      .getByRole("button", { name: "Whisk", exact: true })
      .click();
    const familyNotes = page.getByRole("region", { name: /family notes/i });
    await expect(familyNotes.getByText("settle before the chassé")).toBeVisible({
      timeout: 15_000,
    });
    await expect(familyNotes.getByText("count 3", { exact: true })).toBeVisible();
  });

  test("an entire-figure link scoped 'this choreo only' stays out of the sibling routine", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { RT_A, RT_B } = await seedTwoWaltzRoutines(page);
    await page.goto("/");

    await openPickerOnWhisk(page, "note on the whole whisk");
    await page.getByText("The entire figure").click();
    // Whole-figure placement → the cross-dance scope IS offered.
    await expect(page.getByText("Every dance")).toBeVisible();
    await page.getByText("This choreo only").click();
    await expect(page.getByText("↳ Whisk · whole figure")).toBeVisible();
    await page.getByRole("button", { name: /^done$/i }).click();

    // The save opens the routine's editable store (WS) — wait for the editor to
    // close back to the journal list before navigating away.
    await expect(page.getByRole("list", { name: /journal entries/i })).toBeVisible({
      timeout: 30_000,
    });

    // The annotation lives on Waltz A's Whisk…
    await page.goto(`/routines/${RT_A}`);
    await page
      .getByTestId("reading-view")
      .getByRole("button", { name: "Whisk", exact: true })
      .click();
    const panel = page.getByRole("region", { name: /^annotations$/i });
    await expect(panel.getByText("note on the whole whisk")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");

    // …and does NOT leak to Waltz B (family notes are untouched; the sibling's
    // Whisk shows neither an annotation nor a family note with this text).
    await page.goto(`/routines/${RT_B}`);
    await page
      .getByTestId("reading-view")
      .getByRole("button", { name: "Whisk", exact: true })
      .click();
    await expect(page.getByRole("region", { name: /family notes/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("note on the whole whisk")).toBeHidden();
  });
});
