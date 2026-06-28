// Pixel-diff the committed marketing screenshots against the PR base branch and
// build a sticky before/after PR-comment body. Pure fns are exported for tests;
// main() is the CLI used by .github/workflows/screenshots.yml.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const MARKER = "<!-- screenshot-bot -->";
const SCREENSHOT_DIR = "apps/web/src/marketing/screenshots";

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

  if (changed.length) {
    lines.push("### Changed", "", "| Screenshot | Before | After |", "| --- | --- | --- |");
    for (const r of changed) {
      lines.push(
        `| \`${r.key}\` | <img width="320" src="${raw(ctx, ctx.baseSha, r.file)}"> | <img width="320" src="${raw(ctx, ctx.headSha, r.file)}"> |`,
      );
    }
    lines.push("");
  }
  if (added.length) {
    lines.push("### New", "", "| Screenshot | Image |", "| --- | --- |");
    for (const r of added)
      lines.push(`| \`${r.key}\` | <img width="320" src="${raw(ctx, ctx.headSha, r.file)}"> |`);
    lines.push("");
  }
  if (removed.length) {
    lines.push("### Removed", "", ...removed.map((r) => `- \`${r.key}\` (\`${r.file}\`)`), "");
  }
  return lines.join("\n");
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
  // Args: base SHA, owner, repo, head SHA.
  const [baseSha, owner, repo, headSha] = process.argv.slice(2);
  if (!baseSha || !owner || !repo || !headSha) {
    throw new Error("usage: screenshot-diff.mjs <baseSha> <owner> <repo> <headSha>");
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const manifestUrl = pathToFileURL(
    path.resolve(here, "../apps/web/src/marketing/screenshots.manifest.ts"),
  ).href;
  // The manifest is TS; read its file list with a tolerant regex (no TS loader in CI node).
  const manifestSrc = readFileSync(new URL(manifestUrl), "utf8");
  const files = [...manifestSrc.matchAll(/file:\s*"([^"]+\.png)"/g)].map((m) => m[1]);
  const keys = [...manifestSrc.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);

  const rows = files.map((file, i) => {
    const rel = `${SCREENSHOT_DIR}/${file}`;
    const baseBuf = gitShow(baseSha, rel);
    let headBuf = null;
    try {
      headBuf = readFileSync(rel);
    } catch {
      headBuf = null;
    }
    return { key: keys[i] ?? file, file, status: classify(baseBuf, headBuf).status };
  });

  const ctx = { owner, repo, baseSha, headSha, basePath: SCREENSHOT_DIR };
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
