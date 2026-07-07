// Decide whether a freshly-rendered explainer video is a MEANINGFUL change over
// the committed one, and (in report mode) build the sticky PR-comment body.
//
// Why a threshold and not a byte compare: the MP4 is non-deterministic (h264
// encode + the recorded journey's timing/cursor jitter), so `git diff` on the
// binary is ALWAYS dirty even when the UI is identical. We instead pixel-diff
// the deterministic POSTER frame (a settled real-app view) and treat it as
// changed only when the differing fraction exceeds VIDEO_DIFF_THRESHOLD — real
// UI edits trip it; encode jitter doesn't. Pure fns are exported for tests.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export const MARKER = "<!-- video-bot -->";
const VIDEO_DIR = "apps/web/src/marketing/video";
const POSTER = `${VIDEO_DIR}/explainer-poster.png`;
const VIDEO = `${VIDEO_DIR}/explainer.mp4`;

/** Default: >2% of poster pixels differing counts as a real change. */
export const DEFAULT_THRESHOLD = 0.02;

/**
 * Classify a freshly-rendered poster against the committed one.
 * @returns {{status:'unchanged'|'changed'|'new', changed:boolean, ratio:number, diffPixels:number, total:number}}
 */
export function classifyPoster(prevBuf, nextBuf, ratioThreshold = DEFAULT_THRESHOLD) {
  if (!nextBuf) return { status: "unchanged", changed: false, ratio: 0, diffPixels: 0, total: 0 };
  if (!prevBuf) return { status: "new", changed: true, ratio: 1, diffPixels: 0, total: 0 };
  const a = PNG.sync.read(prevBuf);
  const b = PNG.sync.read(nextBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { status: "changed", changed: true, ratio: 1, diffPixels: 0, total: 0 };
  }
  const total = a.width * a.height;
  const diffPixels = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
  const ratio = total === 0 ? 0 : diffPixels / total;
  const changed = ratio > ratioThreshold;
  return { status: changed ? "changed" : "unchanged", changed, ratio, diffPixels, total };
}

const raw = (owner, repo, sha, file) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${file}`;

/** Sticky before/after comment body. `prevSha` may be null (brand-new asset). */
export function renderComment({ owner, repo, prevSha, newSha, ratio, status }) {
  const lines = [MARKER, "## 🎬 Explainer video", ""];
  if (status === "new") {
    lines.push(
      "First rendered explainer video. ✨",
      "",
      `<a href="${raw(owner, repo, newSha, VIDEO)}"><img width="480" src="${raw(owner, repo, newSha, POSTER)}"></a>`,
    );
    return lines.join("\n");
  }
  lines.push(
    `The running app changed the tour (**${(ratio * 100).toFixed(1)}%** of the poster). Regenerated and committed.`,
    "",
    "| Before | After |",
    "| --- | --- |",
    `| <img width="360" src="${raw(owner, repo, prevSha, POSTER)}"> | <img width="360" src="${raw(owner, repo, newSha, POSTER)}"> |`,
    "",
    `▶ [Watch the updated video](${raw(owner, repo, newSha, VIDEO)})`,
  );
  return lines.join("\n");
}

/** Read a file at a git ref, or null if absent there. */
function gitShow(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], { maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(`${key}=${value}`);
}

function main() {
  const mode = process.argv[2] ?? "decide";
  const threshold = Number(process.env.VIDEO_DIFF_THRESHOLD ?? DEFAULT_THRESHOLD);

  if (mode === "report") {
    // Args: report owner repo prevSha newSha status ratio → writes video-comment.md.
    const [, , , owner, repo, prevSha, newSha, status, ratioArg] = process.argv;
    const body = renderComment({
      owner,
      repo,
      prevSha: prevSha === "-" ? null : prevSha,
      newSha,
      ratio: Number(ratioArg ?? 0),
      status,
    });
    writeFileSync("video-comment.md", body);
    return;
  }

  // decide: compare the committed poster (HEAD) against the working-tree render.
  const prev = gitShow("HEAD", POSTER);
  let next = null;
  try {
    next = readFileSync(POSTER);
  } catch {
    next = null;
  }
  const res = classifyPoster(prev, next, threshold);
  setOutput("changed", String(res.changed));
  setOutput("status", res.status);
  setOutput("ratio", res.ratio.toFixed(4));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
