import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Comment activity fade-out ship gate (docs/concepts/annotations.md § Where
// notes appear): the reading view shows ACTIVE comments by default — last 28
// days, plus anything within 7 days of the newest activity in the list — and
// collapses the rest behind ONE honest counted divider that expands in place.
// Backdated createdAt is seeded through the E2E seed seam (the UI stamps now).
// Runs against the REAL worker (D1 + per-document DOs) via the #191 harness.
//
// @smoke — this journey is the feature's PR gate (delivery model, CLAUDE.md §3).
// ─────────────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const USER = "user_fadeout";

/** Unique refs per run: resetDb wipes only D1 — DO CRDT state survives, so a
 *  reused routine ref would inherit a previous run's annotations (the same
 *  reused-DO-name trap as journal-link-picker.spec.ts). */
function refs() {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return { WHISK: `fig_fade_whisk_${run}`, RT: `rt_fade_${run}` };
}

const whiskFigure = (docRef: string) => ({
  docRef,
  scope: "global" as const,
  ownerId: "app",
  figureType: "whisk",
  dance: "waltz",
  name: "Whisk",
  attributes: [
    { id: "at1", kind: "footwork", count: 1, role: null, value: "HT" },
    { id: "at2", kind: "footwork", count: 2, role: null, value: "T" },
    { id: "at3", kind: "footwork", count: 3, role: null, value: "TH" },
  ],
});

const note = (figureRef: string, id: string, text: string, createdAt: number) => ({
  id,
  authorId: USER,
  kind: "note" as const, // "note" keeps the journal_entry alarm projection out of this journey
  text,
  anchors: [{ type: "point" as const, figureRef, count: 1, role: null }],
  createdAt,
});

test.describe("@smoke comment activity fade-out (reading view)", () => {
  test("comeback Waltz: a 9-comment backdated burst collapses behind '9 more comments'; expand restores all ten in order", async ({
    page,
  }) => {
    const { WHISK, RT } = refs();
    const now = Date.now();
    const mayTexts = Array.from({ length: 9 }, (_, i) => `settled May note ${i + 1}`);
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: USER, displayName: "Dani", identityColor: "#1f8a5b" }],
      figures: [whiskFigure(WHISK)],
      docs: [
        {
          docRef: RT,
          type: "routine",
          ownerId: USER,
          title: "Comp Waltz 2026",
          dance: "waltz",
          sections: [{ id: "sec1", name: "Intro", placements: [{ id: "pl1", figureRef: WHISK }] }],
          annotations: [
            // The May burst: 9 comments, 73d…68d ago (outside 28d, >7d behind the anchor).
            ...mayTexts.map((text, i) => note(WHISK, `ann_may_${i}`, text, now - (73 - i) * DAY)),
            // September: one fresh comment — the anchor.
            note(
              WHISK,
              "ann_fresh",
              "arm line collapsed again — video from Tue",
              now - 60 * 60 * 1000,
            ),
          ],
        },
      ],
      memberships: [{ docRef: RT, userId: USER, role: "editor" }],
      placementEdges: [{ routineRef: RT, figureRef: WHISK }],
    });
    await seedAuth(page, USER);
    await page.goto(`/routines/${RT}`);

    // Reading lens → the count-1 margin cell derives its snippet from the ACTIVE comment only.
    // A directly-navigated routine lands in the READING lens already, so the
    // "reading view" toggle is absent then; switch only if it's showing (a
    // just-built routine sits in EDIT). Mirrors account-doc.spec.ts.
    const toReading = page.getByRole("button", { name: /reading view/i });
    if (await toReading.isVisible().catch(() => false)) await toReading.click();
    const cell = page.getByRole("button", { name: "Notes — count 1" });
    await expect(cell).toContainText("arm line collapsed again", { timeout: 15_000 });
    await expect(cell).not.toContainText("settled May note");

    // Open the thread: fresh comment + ONE honest divider; May stays collapsed.
    await cell.click();
    const thread = page.getByRole("region", { name: /^thread$/i });
    await expect(thread.getByText("arm line collapsed again — video from Tue")).toBeVisible({
      timeout: 15_000,
    });
    const divider = thread.getByRole("button", { name: "9 more comments" });
    await expect(divider).toBeVisible();
    await expect(divider).toHaveAttribute("aria-expanded", "false");
    await expect(thread.getByText("settled May note 1")).toHaveCount(0);
    await expect(thread.getByText(/10 comments/i)).toBeVisible(); // header stays honest

    // Expand in place: all ten, original order (oldest first, fresh last).
    await divider.click();
    const items = thread.getByRole("list", { name: /comment thread/i }).getByRole("listitem");
    await expect(items).toHaveCount(10);
    await expect(items.first()).toContainText("settled May note 1");
    await expect(items.last()).toContainText("arm line collapsed again");

    // The expanded state offers a collapse affordance and it works.
    const collapse = thread.getByRole("button", { name: /showing all · collapse older/i });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await collapse.click();
    await expect(items).toHaveCount(1);
    await expect(thread.getByRole("button", { name: "9 more comments" })).toBeVisible();
  });

  test("quiet Tango half: a 3-comment >28d cluster renders fully — no divider", async ({
    page,
  }) => {
    const { WHISK, RT } = refs();
    const now = Date.now();
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: USER, displayName: "Dani", identityColor: "#1f8a5b" }],
      figures: [whiskFigure(WHISK)],
      docs: [
        {
          docRef: RT,
          type: "routine",
          ownerId: USER,
          title: "Quiet Waltz",
          dance: "waltz",
          sections: [{ id: "sec1", name: "Intro", placements: [{ id: "pl1", figureRef: WHISK }] }],
          annotations: [
            note(WHISK, "ann_q1", "PP shape collapsing — open the right side", now - 45 * DAY),
            note(WHISK, "ann_q2", "lead it from the back, not the arm", now - 43 * DAY),
            note(WHISK, "ann_q3", "better — keep the left side up", now - 42 * DAY),
          ],
        },
      ],
      memberships: [{ docRef: RT, userId: USER, role: "editor" }],
      placementEdges: [{ routineRef: RT, figureRef: WHISK }],
    });
    await seedAuth(page, USER);
    await page.goto(`/routines/${RT}`);

    // A directly-navigated routine lands in the READING lens already, so the
    // "reading view" toggle is absent then; switch only if it's showing (a
    // just-built routine sits in EDIT). Mirrors account-doc.spec.ts.
    const toReading = page.getByRole("button", { name: /reading view/i });
    if (await toReading.isVisible().catch(() => false)) await toReading.click();
    const cell = page.getByRole("button", { name: "Notes — count 1" });
    await expect(cell).toContainText("keep the left side up", { timeout: 15_000 });

    await cell.click();
    const thread = page.getByRole("region", { name: /^thread$/i });
    await expect(thread.getByText("PP shape collapsing — open the right side")).toBeVisible({
      timeout: 15_000,
    });
    await expect(thread.getByText("lead it from the back, not the arm")).toBeVisible();
    await expect(thread.getByText("better — keep the left side up")).toBeVisible();
    await expect(thread.getByRole("button", { name: /more comment/i })).toHaveCount(0);
  });
});
