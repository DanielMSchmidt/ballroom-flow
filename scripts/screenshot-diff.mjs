// Pixel-diff the CI-rendered marketing screenshots against a BASELINE and build
// a sticky before/after PR-comment body. The head images are rendered fresh in
// CI into the workspace and are NOT committed back to the PR branch (see the
// `screenshots` job in .github/workflows/ci.yml) — so there is no bot commit
// and no `[skip ci]`, and the expensive CI gates always run on the PR's real HEAD.
//
// The baseline is, in order of preference:
//   1. SCREENSHOT_BASELINE_DIR — the unpacked `screenshots-baseline` artifact
//      from the last main run of .github/workflows/screenshot-baseline.yml,
//      i.e. what main's code ACTUALLY renders. This is the normal CI path: the
//      committed images stopped being refreshed when the auto-commit bot was
//      removed (2026-07-14), so they drift and can't serve as the diff base.
//      SCREENSHOT_BASELINE_SHA (the main commit that run rendered) is surfaced
//      in the comment for provenance.
//   2. Otherwise (bootstrap, expired artifact, local run): the images COMMITTED
//      at the PR's merge-base SHA, via `git show`.
//
// To show images inline (a comment can only embed an image it can fetch by
// URL — GitHub strips data: URIs), CI uploads the before AND after PNGs as
// assets on a dedicated `ci-screenshots` prerelease and the comment inlines
// their stable `releases/download/...` URLs. That hosts the images WITHOUT any
// commit — no bot commit, no throwaway asset branch — and the "before" shown is
// the exact bytes that were diffed (an artifact baseline has no
// raw.githubusercontent URL at all). The same PNGs are also staged into
// ARTIFACT_DIR as a durable run artifact. When the release-asset env is absent
// (a local run), the comment falls back to a raw.githubusercontent "before" at
// the base SHA + an artifact link.
// (pixelmatch in classify still runs — its pixel count decides changed-vs-unchanged
// per row — but the count itself is no longer surfaced in the comment.)
//
// The staged filenames are the exact release-asset names (ASSET_PREFIX + key +
// ".before.png"/".after.png"), so the upload step can dumb-upload each file under
// its basename and the URL the comment computes matches. Pure fns are exported
// for tests; main() is the CLI.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const MARKER = "<!-- screenshot-bot -->";
const SCREENSHOT_DIR = "apps/web/src/marketing/screenshots";
const ARTIFACT_DIR = "screenshot-artifacts";

/** Compare two PNG buffers (or nulls). Threshold tolerates AA noise. */
export function classify(baseBuf, headBuf) {
  if (!baseBuf && !headBuf) return { status: "unchanged", diffPixels: 0 };
  if (!baseBuf) return { status: "new", diffPixels: 0 };
  if (!headBuf) return { status: "removed", diffPixels: 0 };
  const a = PNG.sync.read(baseBuf);
  const b = PNG.sync.read(headBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { status: "changed", diffPixels: Number.POSITIVE_INFINITY };
  }
  const diffPixels = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
  return { status: diffPixels > 0 ? "changed" : "unchanged", diffPixels };
}

const raw = (ctx, sha, file) =>
  `https://raw.githubusercontent.com/${ctx.owner}/${ctx.repo}/${sha}/${ctx.basePath}/${file}`;

/** Release-asset name for a row's "after" PNG (also its staged filename). */
export const assetName = (prefix, key, kind) => `${prefix}${key}.${kind}.png`;

/** Build the markdown comment body. */
export function renderComment(rows, ctx) {
  const changed = rows.filter((r) => r.status === "changed");
  const added = rows.filter((r) => r.status === "new");
  const removed = rows.filter((r) => r.status === "removed");
  const lines = [MARKER, "## 📸 Screenshot changes", ""];

  if (changed.length === 0 && added.length === 0 && removed.length === 0) {
    lines.push("No screenshot changes in this PR. ✅");
    return lines.join("\n");
  }

  // Images inline only when CI has published them as release assets (stable
  // download URLs). Without that env (a local run), fall back to a committed
  // raw-URL "before" only — a dir-based baseline never applies locally.
  const inline = Boolean(ctx.assetUrlBase && ctx.assetPrefix);
  const img = (src) => `<img width="300" src="${src}">`;
  const assetImg = (r, kind) =>
    img(`${ctx.assetUrlBase}/${assetName(ctx.assetPrefix, r.key, kind)}`);
  // Inline "before" is the staged .before.png asset — the exact bytes diffed
  // (raw.githubusercontent only exists for committed files, not the artifact
  // baseline). The raw URL survives as the non-inline fallback.
  const before = (r) => (inline ? assetImg(r, "before") : img(raw(ctx, ctx.baseSha, r.file)));

  const artifact = ctx.artifactUrl
    ? `[\`screenshots\` artifact](${ctx.artifactUrl})`
    : "`screenshots` artifact";
  const baseline = ctx.baselineSha
    ? `the \`screenshots-baseline\` artifact from the last \`main\` run (\`${ctx.baselineSha.slice(0, 7)}\`)`
    : "the committed base-branch images";
  lines.push(
    inline
      ? `Rendered by CI from this PR's code — **not committed** — and diffed against ${baseline}. The images below are hosted as assets on the \`ci-screenshots\` prerelease; full-resolution copies are also in the ${artifact} on this run.`
      : `Rendered by CI from this PR's code — **not committed** — and diffed against ${baseline}. Full-resolution _after_ images are in the ${artifact} on this run.`,
    "",
  );

  if (changed.length) {
    lines.push("### Changed", "");
    if (inline) {
      lines.push("| Screenshot | Before (base) | After |", "| --- | --- | --- |");
      for (const r of changed) {
        lines.push(`| \`${r.key}\` | ${before(r)} | ${assetImg(r, "after")} |`);
      }
    } else {
      lines.push("| Screenshot | Before (base) |", "| --- | --- |");
      for (const r of changed) {
        lines.push(`| \`${r.key}\` | ${before(r)} |`);
      }
    }
    lines.push("");
  }
  if (added.length) {
    lines.push("### New", "");
    if (inline) {
      lines.push("| Screenshot | After |", "| --- | --- |");
      for (const r of added)
        lines.push(`| \`${r.key}\` (\`${r.file}\`) | ${assetImg(r, "after")} |`);
    } else {
      lines.push(...added.map((r) => `- \`${r.key}\` (\`${r.file}\`) — see artifact`));
    }
    lines.push("");
  }
  if (removed.length) {
    lines.push("### Removed", "");
    if (inline) {
      lines.push("| Screenshot | Before (base) |", "| --- | --- |");
      for (const r of removed) lines.push(`| \`${r.key}\` (\`${r.file}\`) | ${before(r)} |`);
    } else {
      lines.push(...removed.map((r) => `- \`${r.key}\` (\`${r.file}\`)`));
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Parse manifest source into {key, file}[] pairs. Exported for tests. */
export function parseManifestEntries(src) {
  // [^{}]*? stays within a single object literal — it cannot cross into the next
  // entry's braces, so a stray key: field in an unrelated object won't shift pairings.
  return [...src.matchAll(/key:\s*"([^"]+)"[^{}]*?file:\s*"([^"]+\.png)"/g)].map(
    ([, key, file]) => ({ key, file }),
  );
}

/** Read a file from a git ref, or null if it doesn't exist there. */
function gitShow(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], { maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

async function main() {
  // Args: base SHA, owner, repo, [artifact URL].
  const [baseSha, owner, repo, artifactUrl] = process.argv.slice(2);
  if (!baseSha || !owner || !repo) {
    throw new Error("usage: screenshot-diff.mjs <baseSha> <owner> <repo> [artifactUrl]");
  }
  // Release-asset hosting for the "after"/"diff" PNGs (set by CI). ASSET_PREFIX
  // namespaces assets per PR + head SHA so pushes never collide and camo can't
  // serve a stale cached image; ASSET_URL_BASE is the `releases/download/<tag>`
  // prefix. Absent locally → before-only comment, plain artifact filenames.
  const assetUrlBase = process.env.SCREENSHOT_ASSET_URL_BASE ?? "";
  const assetPrefix = process.env.SCREENSHOT_ASSET_PREFIX ?? "";
  // Baseline source (set by CI when the last main run's `screenshots-baseline`
  // artifact was found and unpacked). Absent → committed images at baseSha.
  const baselineDir = process.env.SCREENSHOT_BASELINE_DIR ?? "";
  const baselineSha = process.env.SCREENSHOT_BASELINE_SHA ?? "";

  const here = path.dirname(fileURLToPath(import.meta.url));
  const manifestUrl = pathToFileURL(
    path.resolve(here, "../apps/web/src/marketing/screenshots.manifest.ts"),
  ).href;
  // The manifest is TS; read its file list with a tolerant regex (no TS loader in CI node).
  const manifestSrc = readFileSync(new URL(manifestUrl), "utf8");
  const entries = parseManifestEntries(manifestSrc);

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const readOrNull = (p) => {
    try {
      return readFileSync(p);
    } catch {
      return null;
    }
  };
  const rows = entries.map(({ key, file }) => {
    const rel = `${SCREENSHOT_DIR}/${file}`;
    // Baseline: the main-run artifact when CI fetched one (a key missing there
    // is genuinely "new" — no per-file git fallback, that would diff against a
    // stale committed image); else the committed image at the merge-base.
    const baseBuf = baselineDir ? readOrNull(path.join(baselineDir, file)) : gitShow(baseSha, rel);
    const headBuf = readOrNull(rel);
    const { status, diffPixels } = classify(baseBuf, headBuf);
    // Stage before/after into the artifact dir under their exact release-asset
    // names, so the CI upload step can dumb-upload each file by basename and the
    // URL the comment computes matches 1:1. "before" is staged too because the
    // artifact baseline has no raw.githubusercontent URL to link.
    if ((status === "changed" || status === "new") && headBuf) {
      writeFileSync(path.join(ARTIFACT_DIR, assetName(assetPrefix, key, "after")), headBuf);
    }
    if ((status === "changed" || status === "removed") && baseBuf) {
      writeFileSync(path.join(ARTIFACT_DIR, assetName(assetPrefix, key, "before")), baseBuf);
    }
    return { key, file, status, diffPixels };
  });

  const ctx = {
    owner,
    repo,
    baseSha,
    baselineSha: baselineDir ? baselineSha : "",
    basePath: SCREENSHOT_DIR,
    artifactUrl,
    assetUrlBase,
    assetPrefix,
  };
  writeFileSync("screenshot-comment.md", renderComment(rows, ctx));
  const anyChange = rows.some((r) => r.status !== "unchanged");
  console.log(`changed=${anyChange}`);
}

// Run main() only when invoked as a CLI (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
