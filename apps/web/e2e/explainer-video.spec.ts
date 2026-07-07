import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, expect, type Locator, type Page, test } from "@playwright/test";
import {
  type CaptionMark,
  type PanKeyframe,
  REC_HEIGHT,
  REC_WIDTH,
  TOUR_CLIP,
  TOUR_MARKS_FILE,
  type TourManifest,
} from "../remotion/timeline";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// @video — NOT in @smoke. The RECORDER behind the auto-generated explainer
// video. Drives the REAL app (via the #191 real-worker harness) through ONE
// continuous authoring journey — create → name → section → catalogue figure →
// custom figure → notate → annotation reference → note → reading view → share —
// and records a SINGLE clip (remotion/public/clips/tour.webm).
//
// For every captioned step it timestamps a CaptionMark (ms from the start of
// the recording) into remotion/public/tour-marks.json. Remotion (Explainer.tsx)
// plays the clip at real speed and shows each caption when the playhead reaches
// its mark, so the tour reads like a slow, hand-held walkthrough.
//
// This is a recorder, not an assertion gate: the waits are deliberate PACING so
// a first-timer can see the ring cursor land on each control before it acts.
// Real correctness lives in the smoke journeys this mirrors (authoring /
// annotations / library / permission-quota-invite .spec.ts).
// ─────────────────────────────────────────────────────────────────────────

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../remotion/public");
const CLIPS_DIR = path.join(PUBLIC_DIR, "clips");
const MARKS_PATH = path.join(PUBLIC_DIR, TOUR_MARKS_FILE);
const clip = (name: string) => path.join(CLIPS_DIR, name);

const USER = "user_tour";

// Manually-created contexts don't inherit the config's `use.baseURL`, so wire it
// from the same E2E_PORT the webServer uses (default 4173, see playwright.config).
const BASE_URL = `http://localhost:${process.env.E2E_PORT ?? 4173}`;

// We launch our OWN Chromium (not the project's `browser` fixture) so we can
// point at a specific executable: sandboxes ship a preinstalled Chromium whose
// build may differ from the one @playwright/test would auto-fetch.
function chromiumExecutable(): string | undefined {
  const override = process.env.PW_CHROMIUM_PATH;
  if (override) return override;
  const preinstalled = "/opt/pw-browsers/chromium";
  return existsSync(preinstalled) ? preinstalled : undefined;
}

// A visible pointer for the screencast. Playwright drives the REAL mouse (it
// moves to an element's centre before clicking), but browser recordings don't
// paint a hardware cursor — so we inject our own ring that follows mousemove,
// glides between targets (CSS transition), and fires a ripple on mousedown.
// This is what lets a first-time viewer see *where* every tap lands.
const CURSOR_INIT = `(() => {
  const ACCENT = "rgba(79,134,198,0.95)";
  const install = () => {
    if (document.getElementById("__tour_cursor__")) return;
    if (!document.body) return;
    const ring = document.createElement("div");
    ring.id = "__tour_cursor__";
    Object.assign(ring.style, {
      position: "fixed", left: "0", top: "0", width: "30px", height: "30px",
      marginLeft: "-15px", marginTop: "-15px", borderRadius: "50%",
      border: "3px solid " + ACCENT, background: "rgba(79,134,198,0.16)",
      boxShadow: "0 2px 12px rgba(0,0,0,0.35)", pointerEvents: "none",
      zIndex: "2147483647", transform: "translate(-120px,-120px)",
      transition: "transform 0.34s cubic-bezier(0.22,0.61,0.36,1)", willChange: "transform",
    });
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      position: "absolute", left: "50%", top: "50%", width: "6px", height: "6px",
      marginLeft: "-3px", marginTop: "-3px", borderRadius: "50%",
      background: "rgba(47,93,143,0.95)",
    });
    ring.appendChild(dot);
    document.body.appendChild(ring);
    let x = -120, y = -120;
    window.addEventListener("mousemove", (e) => {
      x = e.clientX; y = e.clientY;
      ring.style.transform = "translate(" + x + "px," + y + "px)";
    }, true);
    window.addEventListener("mousedown", () => {
      ring.animate(
        [{ transform: "translate(" + x + "px," + y + "px) scale(0.65)" },
         { transform: "translate(" + x + "px," + y + "px) scale(1)" }],
        { duration: 300, easing: "ease-out" },
      );
      const r = document.createElement("div");
      Object.assign(r.style, {
        position: "fixed", left: x + "px", top: y + "px", width: "16px", height: "16px",
        marginLeft: "-8px", marginTop: "-8px", borderRadius: "50%",
        border: "3px solid " + ACCENT, pointerEvents: "none", zIndex: "2147483646",
        transform: "scale(1)", opacity: "1",
        transition: "transform 0.55s ease-out, opacity 0.55s ease-out",
      });
      (document.body || document.documentElement).appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(3.6)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
  document.addEventListener("DOMContentLoaded", install);
})()`;

/** A captioned step: narrate (caption appears), pause so it's read, act, settle.
 *  The mark is stamped when the caption appears, so it lines up with the clip. */
type Step = (
  kicker: string,
  caption: string,
  fn: () => Promise<void>,
  opts?: { read?: number; settle?: number },
) => Promise<void>;

/** Pan the window down to reveal below-the-crop controls, then (optionally) back.
 *  `y` is the target objectPosition Y (%); ~90 shows the bottom of a tall dialog. */
type Pan = { reveal: (y: number) => void; restore: (y: number) => void };

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Type into a field at a slow, human pace (char-by-char) instead of pasting it
 *  in one shot — so a first-time viewer can actually watch the text appear. */
async function slowType(field: Locator, text: string, delay = 105): Promise<void> {
  await field.click();
  await field.pressSequentially(text, { delay });
}

/** Make a native <select> read as a deliberate human choice: rest the cursor on
 *  it, pause, pick, then pause again so the new value is seen before moving on. */
async function slowSelect(page: Page, field: Locator, value: string): Promise<void> {
  await field.hover();
  await pause(page, 800);
  await field.selectOption(value);
  await pause(page, 900);
}

test.describe("@video explainer recorder", () => {
  test("record the guided authoring tour", async () => {
    test.setTimeout(300_000);
    const browser = await chromium.launch({ executablePath: chromiumExecutable() });
    try {
      await recordTour(browser);
    } finally {
      await browser.close();
    }
  });
});

async function recordTour(browser: Browser): Promise<void> {
  // Fresh D1 + the single demo user. The tour builds its routine live — nothing
  // is pre-seeded, so what you watch is exactly what a new user would do.
  const bootstrap = await browser.newContext({ baseURL: BASE_URL });
  const boot = await bootstrap.newPage();
  await resetDb(boot);
  await seedDb(boot, {
    users: [{ id: USER, displayName: "Ava Lindqvist", identityColor: "#2f5d8f" }],
  });
  await bootstrap.close();

  await mkdir(CLIPS_DIR, { recursive: true });

  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: REC_WIDTH, height: REC_HEIGHT },
    recordVideo: { dir: CLIPS_DIR, size: { width: REC_WIDTH, height: REC_HEIGHT } },
  });
  await context.addInitScript(CURSOR_INIT);
  const page = await context.newPage();

  // Recording starts at page creation; stamp t0 here so mark times line up.
  const startedAt = Date.now();
  const nowMs = () => Date.now() - startedAt;
  const marks: CaptionMark[] = [];
  const step: Step = async (kicker, caption, fn, opts = {}) => {
    // A generous default GAP between the caption appearing (what we're about to
    // do) and the action starting — the viewer reads the instruction, THEN watches
    // it happen. Deliberately longer than a real user would pause.
    const { read = 2600, settle = 900 } = opts;
    marks.push({ atMs: nowMs(), kicker, caption });
    await pause(page, read); // viewer reads the caption before anything moves
    await fn();
    await pause(page, settle); // the result settles on screen
  };

  // Vertical pan keyframes — see PanKeyframe. `reveal(y)` eases the window down
  // from the top to reveal controls below the crop (call once the dialog is open);
  // `restore(y)` eases back. Emitted from live timestamps so they track the clip.
  const pans: PanKeyframe[] = [];
  const pan: Pan = {
    reveal: (y) => pans.push({ atMs: nowMs(), y: 0 }, { atMs: nowMs() + 900, y }),
    restore: (y) => pans.push({ atMs: nowMs(), y }, { atMs: nowMs() + 600, y: 0 }),
  };

  await seedAuth(page, USER);
  await tourFlow(page, step, pan);

  const durationMs = nowMs();
  await context.close(); // finalizes the webm

  const video = page.video();
  if (!video) throw new Error("no video recorded — recordVideo not enabled?");
  await video.saveAs(clip(TOUR_CLIP));

  const manifest: TourManifest = { clip: TOUR_CLIP, durationMs, marks, pans };
  await writeFile(MARKS_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  expect(existsSync(clip(TOUR_CLIP)), `missing clip ${TOUR_CLIP}`).toBe(true);
  expect(marks.length, "no caption marks recorded").toBeGreaterThan(5);

  // Drop the auto-named temp webms Playwright wrote alongside the saved clip
  // (saveAs COPIES; the originals have hashed names we don't reference).
  for (const f of await readdir(CLIPS_DIR)) {
    if (f.endsWith(".webm") && f !== TOUR_CLIP) await rm(clip(f), { force: true });
  }
}

// The guided journey. Each `step(...)` is one narrated moment in the clip; the
// selectors mirror the real smoke journeys (authoring / library / annotations /
// permission-quota-invite .spec.ts), so this stays honest to the shipped UI.
async function tourFlow(page: Page, step: Step, pan: Pan): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /new choreo/i })).toBeVisible({ timeout: 15_000 });
  await pause(page, 800);

  // 1 — create
  await step(
    "1 · CREATE A CHOREO",
    "Everything starts here — tap “New choreo” to begin.",
    async () => {
      await page.getByRole("button", { name: /new choreo/i }).click();
      await expect(page.getByLabel("Choreo name")).toBeVisible({ timeout: 15_000 });
    },
  );

  // 2 — name + dance
  await step(
    "2 · NAME IT & PICK A DANCE",
    "Give it a name, choose the dance, then create it.",
    async () => {
      await slowType(page.getByLabel("Choreo name"), "Bronze Foxtrot");
      await pause(page, 900);
      await page.getByRole("button", { name: "Foxtrot" }).click();
      await pause(page, 900);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /create choreo/i })
        .click();
      await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({
        timeout: 15_000,
      });
    },
    { settle: 1300 },
  );

  // 3 — add a section
  await step(
    "3 · ADD A SECTION",
    "Sections group your figures. Add one and give it a name.",
    async () => {
      await page.getByRole("button", { name: "Add section" }).click();
      await pause(page, 500);
      await slowType(page.getByLabel("Section name"), "Long Side");
      await pause(page, 700);
      await page.getByLabel("Section name").press("Enter");
      await expect(page.getByRole("heading", { name: "Long Side" })).toBeVisible({
        timeout: 15_000,
      });
    },
  );

  // 4 — add a figure from the catalogue
  await step(
    "4 · ADD FROM THE CATALOGUE",
    "Open the picker and choose a figure from the built-in catalogue.",
    async () => {
      await page.getByRole("button", { name: "Add figure" }).first().click();
      await pause(page, 1000);
      await page.getByRole("button", { name: /feather step/i }).hover();
      await pause(page, 700);
      await page.getByRole("button", { name: /feather step/i }).click();
      await pause(page, 900);
      await page.getByRole("button", { name: /add to choreo/i }).click();
      await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
    },
    { read: 2800, settle: 1300 },
  );

  // 5 — add your own custom figure
  await step(
    "5 · OR ADD YOUR OWN",
    "Not in the catalogue? Type your own figure name and add it.",
    async () => {
      await page.getByRole("button", { name: "Add figure" }).first().click();
      await pause(page, 1000); // picker opens; the catalogue list is shown up top
      // The custom-figure form ("Figure name" + "Add custom") sits at the BOTTOM
      // of the picker, below the crop — pan down to reveal it before we type.
      pan.reveal(90);
      await pause(page, 1200);
      await slowType(page.getByLabel("Figure name"), "My Variation");
      await pause(page, 800);
      await page.getByLabel("Figure name").press("Enter");
      pan.restore(90); // ease back up as the picker closes
      await expect(page.getByText("My Variation")).toBeVisible({ timeout: 15_000 });
    },
    { read: 2800, settle: 1300 },
  );

  // 6 — open a figure and notate a step
  await step(
    "6 · NOTATE THE STEPS",
    "Open a figure to note each step — its direction, footwork and more.",
    async () => {
      await page.getByRole("button", { name: /edit steps: My Variation/i }).click();
      await expect(page.getByRole("table", { name: /step grid/i })).toBeVisible({
        timeout: 15_000,
      });
      await pause(page, 900);
      await page.getByRole("button", { name: /^Add Step at count 1$/i }).click();
      await pause(page, 900);
      await page.getByRole("button", { name: /^Edit Step at count 1$/i }).click();
      await pause(page, 900);
      // Pick the two attributes one at a time, resting on each before tapping.
      await page.getByRole("button", { name: /^Forward$/ }).hover();
      await pause(page, 700);
      await page.getByRole("button", { name: /^Forward$/ }).click();
      await pause(page, 900);
      await page.getByRole("button", { name: /^Heel-Toe$/ }).hover();
      await pause(page, 700);
      await page.getByRole("button", { name: /^Heel-Toe$/ }).click();
      await pause(page, 900);
      await page.getByRole("button", { name: /^Done$/ }).click();
      await expect(page.getByTestId("step-headline-1")).toHaveText(/forward/i, { timeout: 15_000 });
    },
    { read: 3000, settle: 1300 },
  );

  // 7 — the annotation reference
  await step(
    "7 · WHAT DO THEY MEAN?",
    "Unsure what a column means? Tap its header for a plain-language guide.",
    async () => {
      await page
        .getByRole("button", { name: /^About / })
        .first()
        .click();
      await expect(page.getByText(/attribute explainer/i)).toBeVisible({ timeout: 15_000 });
      await pause(page, 2400); // hold so the viewer can read the explainer
      await page.getByRole("button", { name: /back to your spot/i }).click();
      await expect(page.getByRole("table", { name: /step grid/i })).toBeVisible({
        timeout: 15_000,
      });
    },
    { read: 2800, settle: 800 },
  );

  // 8 — leave a note on the figure
  await step(
    "8 · LEAVE A NOTE",
    "Add a lesson or reminder — it stays pinned to this exact figure.",
    async () => {
      const panel = page.getByRole("region", { name: /^annotations$/i });
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await slowSelect(page, panel.getByLabel("Kind"), "lesson");
      await slowType(panel.getByRole("textbox", { name: /^note$/i }), "Rise later on this step.");
      await pause(page, 800);
      await panel.getByRole("button", { name: /add note/i }).click();
      await expect(panel.getByText("Rise later on this step.")).toBeVisible({ timeout: 15_000 });
    },
    { read: 2800, settle: 1300 },
  );

  // Close the full-screen step editor → back to the builder.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /reading view/i })).toBeVisible({
    timeout: 15_000,
  });
  await pause(page, 500);

  // 9 — see the whole routine (reading view)
  await step(
    "9 · SEE THE WHOLE ROUTINE",
    "Switch to the reading view to see the whole choreography laid out.",
    async () => {
      await page.getByRole("button", { name: /reading view/i }).click();
      await expect(page.getByTestId("reading-view")).toBeVisible({ timeout: 15_000 });
    },
    { read: 2600, settle: 2000 },
  );

  // Back to the editing view so Share sits in a known place.
  await page.getByRole("button", { name: /list view/i }).click();
  await pause(page, 500);

  // 10 — share it
  await step(
    "10 · SHARE IT",
    "Invite a partner or coach — pick their role and send them a link.",
    async () => {
      await page.getByRole("button", { name: "Share" }).click();
      const shareSheet = page.getByRole("dialog", { name: /share this choreo/i });
      await expect(shareSheet).toBeVisible({ timeout: 15_000 });
      await pause(page, 1000);
      await shareSheet.getByRole("button", { name: /\+ invite someone/i }).click();
      await pause(page, 900);
      // The role picker + "Create link" sit at the bottom of the dialog — pan
      // down to reveal them (and hold; the tour ends on the created invite).
      pan.reveal(90);
      await pause(page, 1200);
      await slowSelect(page, shareSheet.getByLabel("Role"), "commenter");
      await shareSheet.getByRole("button", { name: "Create link" }).click();
      await expect(shareSheet.locator("code", { hasText: "/invite/" })).toBeVisible({
        timeout: 15_000,
      });
    },
    { read: 2800, settle: 2800 },
  );
}
