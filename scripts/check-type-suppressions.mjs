#!/usr/bin/env node
// Type-honesty gate (CLAUDE.md §4) — the companion to the Biome setup:
//
//   • `as`/`<T>` assertions   → banned by lint-plugins/no-type-assertion.grit (error)
//   • explicit `any`          → banned by Biome noExplicitAny (error)
//   • non-null `!`            → banned by Biome noNonNullAssertion (error)
//   • `// @ts-expect-error`         → banned by Biome noTsIgnore (error)
//   • `// @ts-expect-error` and `// @ts-nocheck` → banned HERE (Biome has no
//     rule for them, and they suppress compiler errors just as silently).
//
// Also enforces that the one sanctioned escape hatch — a
// `biome-ignore lint/plugin:` suppression — only ever appears in a designated
// test-support helper file (the `asInvalid` / test-double pattern), never
// inline in product or test code: the helper is where the justification and
// the runtime guarantee live.
//
// Zero dependencies (Node built-ins only); wired into `pnpm lint`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** Files allowed to carry a `biome-ignore lint/plugin:` suppression — each is
 *  a small, documented compiler-bypass helper (see its file header). Adding a
 *  file here is a review-visible act, which is the point. */
const SUPPRESSION_ALLOWLIST = new Set([
  "packages/domain/src/__fixtures__/invalid.ts",
  "apps/web/src/test-support/test-double.ts",
  "apps/worker/src/test-support/test-peek.ts",
]);

const BANNED_DIRECTIVES = [/@ts-expect-error/, /@ts-nocheck/, /@ts-ignore/];

const files = execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.mts", "*.cts"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const failures = [];
for (const file of files) {
  if (!existsSync(file)) continue; // tracked but deleted in the working tree
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const directive of BANNED_DIRECTIVES) {
      if (directive.test(line)) {
        failures.push(
          `${file}:${i + 1}: banned suppression directive (${directive.source}) — fix the type instead (CLAUDE.md §4)`,
        );
      }
    }
    if (line.includes("biome-ignore lint/plugin") && !SUPPRESSION_ALLOWLIST.has(file)) {
      failures.push(
        `${file}:${i + 1}: 'biome-ignore lint/plugin' outside the allowlisted helpers — route the bypass through a documented test-support helper (scripts/check-type-suppressions.mjs)`,
      );
    }
  });
}

if (failures.length > 0) {
  console.error("Type-honesty gate failed:\n");
  for (const f of failures) console.error(`  ${f}`);
  console.error(`\n${failures.length} violation(s).`);
  process.exit(1);
}
console.log(`Type-honesty gate: ${files.length} files clean.`);
