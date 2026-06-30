// Regenerate packages/domain/src/figure-charts.generated.ts from the researched
// per-step chart seed (docs/seed/figure-charts.json).
//   node scripts/gen-figure-charts.mjs
// The seed holds real WDSF-first International Standard technique, researched per
// figure with source attribution (NO fabrication — unverifiable figures were removed
// from the catalog instead). This script shapes it into the AuthoredStep table the
// domain reads (figure-steps.ts). It also drops no-op values (sway/turn "none") so
// the timeline isn't cluttered. After writing, runs biome to normalise whitespace.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(readFileSync(resolve(root, "docs/seed/figure-charts.json"), "utf8"));

const role = (r) => {
  const o = { direction: r.direction, footwork: r.footwork };
  if (r.sway && r.sway !== "none") o.sway = r.sway;
  if (r.turn && r.turn !== "none") o.turn = r.turn;
  if (Array.isArray(r.bodyActions) && r.bodyActions.length) o.bodyActions = r.bodyActions;
  return o;
};
const step = (s) => {
  const o = {};
  if (s.rise) o.rise = s.rise;
  if (s.position) o.position = s.position;
  o.leader = role(s.leader);
  o.follower = role(s.follower);
  return o;
};

const table = {};
for (const fig of seed.figures) table[`${fig.dance}:${fig.figureType}`] = fig.steps.map(step);

const header = `// GENERATED from docs/seed/figure-charts.json by scripts/gen-figure-charts.mjs.
// Real per-step both-role technique (WDSF-first, dancecentral.info primary), researched
// per figure with source attribution in the seed. Do not edit by hand — regenerate instead.
import type { AuthoredStep } from "./figure-steps";

export const GENERATED_FIGURE_STEPS: Record<string, readonly AuthoredStep[]> = ${JSON.stringify(table, null, 2)};
`;
const outPath = resolve(root, "packages/domain/src/figure-charts.generated.ts");
writeFileSync(outPath, header);
execSync(`pnpm exec biome format --write ${outPath}`, { cwd: root, stdio: "ignore" });
console.log(
  `wrote ${Object.keys(table).length} charts to packages/domain/src/figure-charts.generated.ts`,
);
