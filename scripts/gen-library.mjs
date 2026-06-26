// Regenerate packages/domain/src/library-data.ts from the ISTD seed.
//   node scripts/gen-library.mjs
// Shapes docs/seed/istd-standard-figures.json (the ISTD International Standard
// syllabus figure list) into the client-bundled figure catalog. Per-count
// attribute timelines are filled by the content workstream later; this carries
// only the identity fields (dance, figureType, name) the picker/library need.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(
  readFileSync(resolve(root, "docs/seed/istd-standard-figures.json"), "utf8"),
);
const DANCE_ORDER = ["waltz", "viennese_waltz", "quickstep", "foxtrot", "tango"];

const seen = new Set();
const rows = [];
for (const f of seed.figures) {
  const key = `${f.dance}::${f.name}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({ dance: f.dance, figureType: f.figureType, name: f.name });
}
rows.sort(
  (a, b) =>
    DANCE_ORDER.indexOf(a.dance) - DANCE_ORDER.indexOf(b.dance) || a.name.localeCompare(b.name),
);

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const body = rows
  .map(
    (r) => `  { dance: "${r.dance}", figureType: "${esc(r.figureType)}", name: "${esc(r.name)}" },`,
  )
  .join("\n");

const out = `// GENERATED from docs/seed/istd-standard-figures.json — do not edit by hand.
// Regenerate with scripts/gen-library.mjs. Source: ISTD International Standard
// (Modern Ballroom) syllabus figure list — shaped into the client-bundled figure
// catalog (PLAN reference-data decision; per-count attributes are filled later).
import type { DanceId } from "./dances";

export interface LibraryFigureData {
  dance: DanceId;
  figureType: string;
  name: string;
}

/** ${rows.length} canonical figures across the five Standard dances. */
export const LIBRARY_FIGURE_DATA: readonly LibraryFigureData[] = [
${body}
];
`;

writeFileSync(resolve(root, "packages/domain/src/library-data.ts"), out);
console.log(`wrote ${rows.length} figures to packages/domain/src/library-data.ts`);
