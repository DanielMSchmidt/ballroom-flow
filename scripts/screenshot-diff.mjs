// Pixel-diff the CI-rendered marketing screenshots against the PR base branch's
// COMMITTED images and build a sticky before/after/diff PR-comment body. The head
// images are rendered fresh in CI into the workspace and are NOT committed back
// to the PR branch (see the `screenshots` job in .github/workflows/ci.yml) — so
// there is no bot commit and no `[skip ci]`, and the expensive CI gates always
// run on the PR's real HEAD.
//
// To show the "after" and "diff" inline (a comment can only embed an image it can
// fetch by URL — GitHub strips data: URIs), CI uploads those PNGs as assets on a
// dedicated `ci-screenshots` prerelease and the comment inlines their stable
// `releases/download/...` URLs. That hosts the images WITHOUT any commit — no bot
// commit, no throwaway asset branch. The "before" column stays a raw.githubusercontent
// URL at the base SHA (it is committed). The same PNGs are also staged into
// ARTIFACT_DIR as a durable run artifact. When the release-asset env is absent
// (a local run), the comment falls back to before-only + an artifact link.
//
// The staged filenames are the exact release-asset names (ASSET_PREFIX + key +
// ".after.png"/".diff.png"), so the upload step can dumb-upload each file under its
// basename and the URLs the comment computes match. Pure fns are exported for
// tests; main() is the CLI.
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

/** Render a pixelmatch diff PNG buffer for two same-size images, else null. */
export function renderDiff(baseBuf, headBuf) {
  if (!baseBuf || !headBuf) return null;
  const a = PNG.sync.read(baseBuf);
  const b = PNG.sync.read(headBuf);
  if (a.width !== b.width || a.height !== b.height) return null;
  const out = new PNG({ width: a.width, height: a.height });
  pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });
  return PNG.sync.write(out);
}

const raw = (ctx, sha, file) =>
  `https://raw.githubusercontent.com/${ctx.owner}/${ctx.repo}/${sha}/${ctx.basePath}/${file}`;

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString("en-US") : "resized");

/** Release-asset name for a row's "after"/"diff" PNG (also its staged filename). */
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

  // "after"/"diff" inline only when CI has published them as release assets (their
  // stable download URLs). Without that env (a local run), fall back to before-only.
  const inline = Boolean(ctx.assetUrlBase && ctx.assetPrefix);
  const img = (src) => `<img width="300" src="${src}">`;
  const before = (r) => img(raw(ctx, ctx.baseSha, r.file));
  const assetImg = (r, kind) =>
    img(`${ctx.assetUrlBase}/${assetName(ctx.assetPrefix, r.key, kind)}`);

  const artifact = ctx.artifactUrl
    ? `[\`screenshots\` artifact](${ctx.artifactUrl})`
    : "`screenshots` artifact";
  lines.push(
    inline
      ? `Rendered by CI from this PR's code — **not committed**. The _after_ and _diff_ images below are hosted as assets on the \`ci-screenshots\` prerelease; full-resolution copies are also in the ${artifact} on this run.`
      : `Rendered by CI from this PR's code — **not committed**. Full-resolution _after_ and _diff_ images are in the ${artifact} on this run.`,
    "",
  );

  if (changed.length) {
    lines.push("### Changed", "");
    if (inline) {
      lines.push(
        "| Screenshot | Before (base) | After | Diff | Δ pixels |",
        "| --- | --- | --- | --- | --- |",
      );
      for (const r of changed) {
        lines.push(
          `| \`${r.key}\` | ${before(r)} | ${assetImg(r, "after")} | ${assetImg(r, "diff")} | ${fmt(r.diffPixels)} |`,
        );
      }
    } else {
      lines.push("| Screenshot | Before (base) | Δ pixels |", "| --- | --- | --- |");
      for (const r of changed) {
        lines.push(`| \`${r.key}\` | ${before(r)} | ${fmt(r.diffPixels)} |`);
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

  const here = path.dirname(fileURLToPath(import.meta.url));
  const manifestUrl = pathToFileURL(
    path.resolve(here, "../apps/web/src/marketing/screenshots.manifest.ts"),
  ).href;
  // The manifest is TS; read its file list with a tolerant regex (no TS loader in CI node).
  const manifestSrc = readFileSync(new URL(manifestUrl), "utf8");
  const entries = parseManifestEntries(manifestSrc);

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const rows = entries.map(({ key, file }) => {
    const rel = `${SCREENSHOT_DIR}/${file}`;
    const baseBuf = gitShow(baseSha, rel);
    let headBuf = null;
    try {
      headBuf = readFileSync(rel);
    } catch {
      headBuf = null;
    }
    const { status, diffPixels } = classify(baseBuf, headBuf);
    // Stage the fresh "after" (and a rendered "diff") into the artifact dir under
    // their exact release-asset names, so the CI upload step can dumb-upload each
    // file by basename and the URLs the comment computes match 1:1.
    if ((status === "changed" || status === "new") && headBuf) {
      writeFileSync(path.join(ARTIFACT_DIR, assetName(assetPrefix, key, "after")), headBuf);
      const diff = renderDiff(baseBuf, headBuf);
      if (diff) writeFileSync(path.join(ARTIFACT_DIR, assetName(assetPrefix, key, "diff")), diff);
    }
    return { key, file, status, diffPixels };
  });

  const ctx = {
    owner,
    repo,
    baseSha,
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
