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
  // r.rotation and r.head (the WDSF Rotation + head-position "Extension" prose
  // columns) are deliberately NOT emitted (⟳2026-07-10): `turn` is the canonical
  // rotation; the seed keeps both transcriptions as provenance only.
  return o;
};
const step = (s) => {
  const o = {};
  if (s.rise) o.rise = s.rise;
  if (s.position) o.position = s.position;
  // A role may be absent on a count the other role dances alone (asymmetric charts).
  if (s.leader) o.leader = role(s.leader);
  if (s.follower) o.follower = role(s.follower);
  return o;
};

const table = {};
for (const fig of seed.figures) {
  const key = `${fig.dance}:${fig.figureType}`;
  table[key] = fig.steps.map(step);
  // fig.entryAlignment / fig.exitAlignment (the charted figure-level alignments)
  // are deliberately NOT emitted (⟳2026-07-12, entry/exit alignment removed from
  // the model): the seed keeps both as provenance only, like rotation/head.
}

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
