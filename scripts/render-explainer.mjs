// Render the auto-generated explainer video from the clip recorded by the
// @video Playwright journey. Two committed marketing assets come out:
//   apps/web/src/marketing/video/explainer.mp4          (embedded via <video>)
//   apps/web/src/marketing/video/explainer-poster.png   (its <video> poster)
//
// Prereqs (the `video:generate` script wires them in order):
//   1. `playwright test --grep @video` has written remotion/public/clips/tour.webm
//      AND remotion/public/tour-marks.json (the timed step captions);
//   2. Chromium is available — we point Remotion at the sandbox's preinstalled
//      headless shell (same one Playwright uses) instead of downloading one.
//
// Usage: node scripts/render-explainer.mjs
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "apps/web");
const REMOTION_ENTRY = path.join(WEB, "remotion/index.ts");
const PUBLIC_DIR = path.join(WEB, "remotion/public");
const CLIPS_DIR = path.join(PUBLIC_DIR, "clips");
const MARKS_PATH = path.join(PUBLIC_DIR, "tour-marks.json");
const OUT_DIR = path.join(WEB, "src/marketing/video");

// Kept in sync with INTRO_CARD.seconds in apps/web/remotion/timeline.ts — the
// intro card that precedes the recorded tour, so poster math can offset past it.
const INTRO_SECONDS = 4;

// Point Remotion at the sandbox's preinstalled headless Chromium. Overridable so
// CI / another machine can supply its own (or let Remotion download one when
// REMOTION_BROWSER is left unset AND the default path is absent).
const DEFAULT_BROWSER = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const browserExecutable =
  process.env.REMOTION_BROWSER ?? (existsSync(DEFAULT_BROWSER) ? DEFAULT_BROWSER : null);

async function main() {
  // The clip + its caption marks are written by the journey; fail loudly (not
  // silently blank) if they're missing.
  if (!existsSync(path.join(CLIPS_DIR, "tour.webm")) || !existsSync(MARKS_PATH)) {
    throw new Error(
      "Missing recorded tour (remotion/public/clips/tour.webm + tour-marks.json).\n" +
        "Record it first:  pnpm video:record",
    );
  }
  /** @type {{ clip: string, durationMs: number, marks: {atMs:number,kicker:string,caption:string}[] }} */
  const manifest = JSON.parse(readFileSync(MARKS_PATH, "utf8"));
  const inputProps = { tourDurationMs: manifest.durationMs, marks: manifest.marks };

  await mkdir(OUT_DIR, { recursive: true });

  // No preinstalled/overridden Chromium (e.g. CI) → let Remotion download and
  // manage its own headless browser so the render still works.
  if (!browserExecutable) {
    console.log("[explainer] no local Chromium — ensuring Remotion's managed browser…");
    await ensureBrowser();
  }

  console.log("[explainer] bundling Remotion project…");
  const serveUrl = await bundle({ entryPoint: REMOTION_ENTRY, publicDir: PUBLIC_DIR });

  const composition = await selectComposition({
    serveUrl,
    id: "Explainer",
    browserExecutable,
    inputProps,
  });
  console.log(
    `[explainer] composition ${composition.width}×${composition.height}, ` +
      `${composition.durationInFrames} frames @ ${composition.fps}fps ` +
      `(${manifest.marks.length} caption steps)`,
  );

  const chromiumOptions = { gl: "swiftshader" };

  // Poster: a SETTLED frame in the "see the whole routine" step (the reading
  // view laid out — a clean, representative shot). Land ~1.3s after that step's
  // caption mark, offset past the intro card. A settled frame keeps the poster
  // near-identical run-to-run so the CI bot's pixel-diff reflects real UI
  // changes, not recording jitter. Falls back to mid-tour if the step is absent.
  const overview =
    manifest.marks.find(
      (m) => /whole routine/i.test(m.kicker) || /reading view/i.test(m.caption),
    ) ?? manifest.marks[Math.floor(manifest.marks.length / 2)];
  // ~3s after the step's caption mark: past its read-pause + the toggle, so the
  // reading view has actually settled on screen (not the editing view before it).
  const posterSeconds =
    INTRO_SECONDS + (overview ? overview.atMs / 1000 + 3 : manifest.durationMs / 2000);
  const posterFrame = Math.min(
    Math.round(posterSeconds * composition.fps),
    composition.durationInFrames - 1,
  );
  console.log(`[explainer] rendering poster (frame ${posterFrame})…`);
  await renderStill({
    composition,
    serveUrl,
    output: path.join(OUT_DIR, "explainer-poster.png"),
    frame: posterFrame,
    browserExecutable,
    chromiumOptions,
    inputProps,
  });

  console.log("[explainer] rendering video (h264 mp4)…");
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    // Small, web-friendly file: CRF 28 is plenty for a UI screencast.
    crf: 28,
    outputLocation: path.join(OUT_DIR, "explainer.mp4"),
    browserExecutable,
    chromiumOptions,
    inputProps,
  });

  console.log(`[explainer] done → ${path.relative(ROOT, OUT_DIR)}/explainer.mp4 (+ poster)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
