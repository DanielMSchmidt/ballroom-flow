import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, expect, type Page, test } from "@playwright/test";
import { HEIGHT, SCENES, WIDTH } from "../remotion/timeline";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// @video — NOT in @smoke. The RECORDER behind the auto-generated explainer
// video. Drives the REAL app (via the #191 real-worker harness) through the
// authoring, commenting and journaling journeys and records ONE webm clip per
// `scene` in remotion/timeline.ts. scripts/render-explainer.mjs then stitches
// them with the intro/info/outro cards into the committed marketing MP4.
//
// This is a recorder, not an assertion gate: the light waits below are
// deliberate PACING for a readable screencast (the composition speeds each clip
// up ~2×), not sync waits — real correctness lives in the smoke journeys these
// mirror (authoring/annotations/journal .spec.ts).
// ─────────────────────────────────────────────────────────────────────────

const CLIPS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../remotion/public/clips",
);
const clip = (name: string) => path.join(CLIPS_DIR, name);
const scene = (id: string) => {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene: ${id}`);
  return s;
};

const USER = "user_tour";
const DEMO_ROUTINE = "routine:tour-journal";

// Manually-created contexts don't inherit the config's `use.baseURL`, so wire it
// from the same E2E_PORT the webServer uses (default 4173, see playwright.config).
const BASE_URL = `http://localhost:${process.env.E2E_PORT ?? 4173}`;

// We launch our OWN Chromium (not the project's `browser` fixture) so we can
// point at a specific executable: sandboxes ship a preinstalled Chromium whose
// build may differ from the one @playwright/test would auto-fetch. Honour an
// explicit override, else the standard preinstalled symlink, else Playwright's
// own managed browser (CI, where the versions match).
function chromiumExecutable(): string | undefined {
  const override = process.env.PW_CHROMIUM_PATH;
  if (override) return override;
  const preinstalled = "/opt/pw-browsers/chromium";
  return existsSync(preinstalled) ? preinstalled : undefined;
}

/** A recorded page in its own video context (one webm per scene). */
async function recordScene(browser: Browser, flow: (page: Page) => Promise<void>): Promise<Page> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: CLIPS_DIR, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await context.newPage();
  await seedAuth(page, USER);
  await flow(page);
  await context.close(); // finalizes the webm
  return page;
}

/** Deliberate on-screen pacing for the screencast (see header). */
const beat = (page: Page, ms = 650) => page.waitForTimeout(ms);

async function saveClip(page: Page, file: string): Promise<void> {
  const video = page.video();
  if (!video) throw new Error("no video recorded — recordVideo not enabled?");
  await video.saveAs(clip(file));
}

test.describe("@video explainer recorder", () => {
  test("record the authoring, commenting and journaling clips", async () => {
    test.setTimeout(240_000);

    const browser = await chromium.launch({ executablePath: chromiumExecutable() });
    try {
      await recordAll(browser);
    } finally {
      await browser.close();
    }
  });
});

async function recordAll(browser: Browser): Promise<void> {
  // Fresh D1 + the demo user, plus a small pre-built journal for the closing
  // scene (deterministic + fast — no waiting on the async DO alarm projection).
  const bootstrap = await browser.newContext({ baseURL: BASE_URL });
  const boot = await bootstrap.newPage();
  await resetDb(boot);
  await seedDb(boot, {
    users: [{ id: USER, displayName: "Ava Lindqvist", identityColor: "#2f5d8f" }],
    docs: [
      {
        docRef: DEMO_ROUTINE,
        type: "routine",
        ownerId: USER,
        title: "Gold Waltz — comp routine",
        dance: "waltz",
      },
    ],
    journalEntries: [
      {
        entryId: "je-tour-1",
        routineRef: DEMO_ROUTINE,
        authorId: USER,
        kind: "lesson",
        text: "Keep the head left through the whole Natural Turn.",
        anchors: [{ type: "figure", label: "Natural Turn" }],
        createdAt: Date.now() - 86_400_000,
      },
      {
        entryId: "je-tour-2",
        routineRef: DEMO_ROUTINE,
        authorId: USER,
        kind: "practice",
        text: "Ran the Long Side five times — sway is landing now.",
        anchors: [{ type: "figure", label: "Whisk" }],
        createdAt: Date.now() - 3_600_000,
      },
      {
        entryId: "je-tour-3",
        routineRef: DEMO_ROUTINE,
        authorId: USER,
        kind: "lesson",
        text: "Rise later on the Chassé from PP.",
        anchors: [{ type: "figure", label: "Chassé from PP" }],
        createdAt: Date.now() - 600_000,
      },
    ],
  });
  await bootstrap.close();

  await mkdir(CLIPS_DIR, { recursive: true });

  // ── Scene 1: AUTHOR — build a routine + open the notation grid. ──────────
  const authorPage = await recordScene(browser, async (page) => {
    await page.goto("/");
    await beat(page);
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Choreo name").fill("Bronze Waltz");
    await beat(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /create choreo/i })
      .click();

    await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({
      timeout: 15_000,
    });
    await beat(page);
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByLabel("Section name").fill("Long Side");
    await page.getByLabel("Section name").press("Enter");
    await expect(page.getByRole("heading", { name: "Long Side" })).toBeVisible({
      timeout: 15_000,
    });
    for (const figure of ["Natural Spin Turn", "Reverse Turn", "Whisk", "Chassé from PP"]) {
      await page.getByRole("button", { name: "Add figure" }).last().click();
      await page.getByLabel("Figure name").fill(figure);
      await page.getByLabel("Figure name").press("Enter");
      await expect(page.getByText(figure).first()).toBeVisible({ timeout: 15_000 });
      await beat(page, 420);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await beat(page);
    // Open the notation grid — the visual centrepiece of authoring.
    await page
      .getByRole("button", { name: /edit steps: Natural Spin Turn/i })
      .first()
      .click();
    await expect(page.getByRole("table", { name: /step grid/i })).toBeVisible({
      timeout: 15_000,
    });
    await beat(page, 1400);
  });
  await saveClip(authorPage, scene("author").clip);

  // ── Scene 2: ANNOTATE — leave a lesson + reply on a figure. ─────────────
  const annotatePage = await recordScene(browser, async (page) => {
    await page.goto("/");
    await beat(page);
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Choreo name").fill("Foxtrot — lesson notes");
    await page.getByRole("button", { name: "Foxtrot" }).click();
    await beat(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /create choreo/i })
      .click();

    await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByLabel("Section name").fill("Intro");
    await page.getByLabel("Section name").press("Enter");
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByLabel("Figure name").fill("Feather Step");
    await page.getByLabel("Figure name").press("Enter");
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
    await beat(page);

    await page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    const panel = page.getByRole("region", { name: /^annotations$/i });
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await beat(page);
    await panel.getByLabel("Kind").selectOption("lesson");
    await panel.getByRole("textbox", { name: /^note$/i }).fill("Keep the head left.");
    await beat(page, 400);
    await panel.getByRole("button", { name: /add note/i }).click();
    await expect(panel.getByText("Keep the head left.")).toBeVisible({ timeout: 15_000 });
    await beat(page);
    await panel.getByRole("textbox", { name: /reply/i }).fill("On every Feather.");
    await beat(page, 400);
    await panel.getByRole("button", { name: /post reply/i }).click();
    await expect(panel.getByText("On every Feather.")).toBeVisible({ timeout: 15_000 });
    await beat(page, 1200);
  });
  await saveClip(annotatePage, scene("annotate").clip);

  // ── Scene 3: JOURNAL — the pre-seeded cross-routine journal + a filter. ──
  const journalPage = await recordScene(browser, async (page) => {
    await page.goto("/");
    await beat(page);
    const rail = page.getByRole("navigation", { name: /primary navigation/i });
    await rail.getByRole("button", { name: "Journal" }).click();
    const entries = page.getByRole("list", { name: /journal entries/i });
    // Assert on the seeded entry's UNIQUE tail — the annotate scene's own
    // lesson may also have projected into the journal by now (both start
    // "Keep the head left"), which would trip strict-mode matching.
    await expect(entries.getByText(/through the whole Natural Turn/)).toBeVisible({
      timeout: 15_000,
    });
    await beat(page, 1400);
    // Filter to lessons — a designed interaction, and it keeps the shot lively.
    await page.getByRole("button", { name: /^lessons$/i }).click();
    await beat(page, 1600);
  });
  await saveClip(journalPage, scene("journal").clip);

  // Every scene produced a clip.
  for (const s of SCENES) {
    expect(existsSync(clip(s.clip)), `missing clip ${s.clip}`).toBe(true);
  }

  // Drop the auto-named temp webms Playwright wrote alongside the saved clips
  // (saveAs COPIES; the originals have hashed names we don't reference).
  const { readdir } = await import("node:fs/promises");
  const keep = new Set(SCENES.map((s) => s.clip));
  for (const f of await readdir(CLIPS_DIR)) {
    if (f.endsWith(".webm") && !keep.has(f)) await rm(clip(f), { force: true });
  }
}
