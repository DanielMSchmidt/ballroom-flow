// Render the auto-generated explainer video from the clips recorded by the
// @video Playwright journey. Two committed marketing assets come out:
//   apps/web/src/marketing/video/explainer.mp4          (embedded via <video>)
//   apps/web/src/marketing/video/explainer-poster.png   (its <video> poster)
//
// Prereqs (the `video:generate` script wires them in order):
//   1. `playwright test --grep @video` has written remotion/public/clips/*.webm
//   2. Chromium is available — we point Remotion at the sandbox's preinstalled
//      headless shell (same one Playwright uses) instead of downloading one.
//
// Usage: node scripts/render-explainer.mjs
import { existsSync, readdirSync } from "node:fs";
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
const OUT_DIR = path.join(WEB, "src/marketing/video");

// Point Remotion at the sandbox's preinstalled headless Chromium. Overridable so
// CI / another machine can supply its own (or let Remotion download one when
// REMOTION_BROWSER is left unset AND the default path is absent).
const DEFAULT_BROWSER = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const browserExecutable =
  process.env.REMOTION_BROWSER ?? (existsSync(DEFAULT_BROWSER) ? DEFAULT_BROWSER : null);

async function main() {
  // The clips are recorded by the journey; fail loudly (not silently blank) if
  // none are present (the composition staticFile()s the exact per-scene names,
  // and Remotion errors clearly if a specific one is missing).
  const clips = existsSync(CLIPS_DIR)
    ? readdirSync(CLIPS_DIR).filter((f) => f.endsWith(".webm"))
    : [];
  if (clips.length === 0) {
    throw new Error(
      `No recorded clips in ${path.relative(ROOT, CLIPS_DIR)}.\n` +
        "Record them first:  pnpm video:record",
    );
  }

  await mkdir(OUT_DIR, { recursive: true });

  // No preinstalled/overridden Chromium (e.g. CI) → let Remotion download and
  // manage its own headless browser so the render still works.
  if (!browserExecutable) {
    console.log("[explainer] no local Chromium — ensuring Remotion's managed browser…");
    await ensureBrowser();
  }

  console.log("[explainer] bundling Remotion project…");
  const serveUrl = await bundle({ entryPoint: REMOTION_ENTRY, publicDir: PUBLIC_DIR });

  const composition = await selectComposition({ serveUrl, id: "Explainer", browserExecutable });
  console.log(
    `[explainer] composition ${composition.width}×${composition.height}, ` +
      `${composition.durationInFrames} frames @ ${composition.fps}fps`,
  );

  const chromiumOptions = { gl: "swiftshader" };

  // Poster: a SETTLED frame in the author scene's static tail (the open step
  // grid, ~12.3s into the composition — intro card 4.0s + the author clip's
  // final settle, window + caption on, cursor at rest). A settled frame keeps
  // the poster near-identical run-to-run so the CI bot's poster pixel-diff
  // reflects real UI changes, not recording jitter. Update if the timeline
  // (apps/web/remotion/timeline.ts) reorders scenes or retimes the author clip.
  const posterFrame = Math.min(
    Math.round(12.3 * composition.fps),
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
  });

  console.log(`[explainer] done → ${path.relative(ROOT, OUT_DIR)}/explainer.mp4 (+ poster)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
