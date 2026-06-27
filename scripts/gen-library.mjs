// Regenerate packages/domain/src/library-data.ts from ISTD + WDSF seeds.
//   node scripts/gen-library.mjs
// Shapes docs/seed/istd-standard-figures.json (ISTD Standard syllabus, system of
// record) and docs/seed/wdsf-standard-figures.json (WDSF syllabus, timing data)
// into the client-bundled figure catalog. ISTD is deduplicated first; WDSF
// provides timing/start/finish/notes for both overlapping and net-new figures.
// The parser logic lives only in TS (buildWdsfAttributes) — no duplication here.
// After writing, runs `biome format --write` to normalise whitespace so `pnpm lint` passes.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const istd = JSON.parse(
  readFileSync(resolve(root, "docs/seed/istd-standard-figures.json"), "utf8"),
);
const wdsf = JSON.parse(
  readFileSync(resolve(root, "docs/seed/wdsf-standard-figures.json"), "utf8"),
);
const DANCE_ORDER = ["waltz", "viennese_waltz", "quickstep", "foxtrot", "tango"];

// Normalise a (dance, name) pair for dedup/enrichment lookup — strips diacritics
// and lowercases so accent-twins (e.g. "Chassé" vs "Chasse") are treated as the
// same figure. Used ONLY for map/set keys; emitted names keep the ISTD original.
const normKey = (dance, name) =>
  `${dance}::${name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()}`;

// Build a lookup of WDSF timing data by (dance, name).
const wdsfByKey = new Map();
for (const f of wdsf.figures) {
  const key = normKey(f.dance, f.name);
  wdsfByKey.set(key, f.wdsf ?? {});
}

const seen = new Set();
const rows = [];
// ISTD first (system of record): identity fields from ISTD.
// Enrich with WDSF timing/start/finish/notes when the WDSF seed has it.
for (const f of istd.figures) {
  const key = normKey(f.dance, f.name);
  if (seen.has(key)) continue;
  seen.add(key);
  const w = wdsfByKey.get(key);
  if (w?.timing) {
    rows.push({
      dance: f.dance,
      figureType: f.figureType,
      name: f.name,
      timing: w.timing ?? "",
      start: w.start ?? "",
      finish: w.finish ?? "",
      notes: w.notes ?? [],
    });
  } else {
    rows.push({ dance: f.dance, figureType: f.figureType, name: f.name });
  }
}
// WDSF net-new: carry timing/start/finish/notes so library.ts can parse steps.
for (const f of wdsf.figures) {
  const key = normKey(f.dance, f.name);
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({
    dance: f.dance,
    figureType: f.figureType,
    name: f.name,
    timing: f.wdsf?.timing ?? "",
    start: f.wdsf?.start ?? "",
    finish: f.wdsf?.finish ?? "",
    notes: f.wdsf?.notes ?? [],
  });
}
rows.sort(
  (a, b) =>
    DANCE_ORDER.indexOf(a.dance) - DANCE_ORDER.indexOf(b.dance) || a.name.localeCompare(b.name),
);

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const body = rows
  .map((r) => {
    if (!r.timing) {
      // Identity-only: short single-line form.
      return `  { dance: "${r.dance}", figureType: "${esc(r.figureType)}", name: "${esc(r.name)}" },`;
    }
    // WDSF-enriched: multi-line form so Biome formatter is satisfied.
    // notes items indent 6 spaces (4-space object body + 2-space array item);
    // closing bracket at 4 spaces (matching the `notes:` key indent).
    const notesItems = (r.notes ?? []).map((n) => `      "${esc(n)}",`).join("\n");
    const notesBlock = notesItems ? `[\n${notesItems}\n    ]` : "[]";
    return [
      "  {",
      `    dance: "${r.dance}",`,
      `    figureType: "${esc(r.figureType)}",`,
      `    name: "${esc(r.name)}",`,
      `    timing: "${esc(r.timing)}",`,
      `    start: "${esc(r.start)}",`,
      `    finish: "${esc(r.finish)}",`,
      `    notes: ${notesBlock},`,
      "  },",
    ].join("\n");
  })
  .join("\n");

const out = `// GENERATED from docs/seed/istd-standard-figures.json + docs/seed/wdsf-standard-figures.json (net-new merged; see scripts/gen-library.mjs)
// Regenerate with scripts/gen-library.mjs. Source: ISTD International Standard
// (Modern Ballroom) syllabus (system of record) + WDSF syllabus timing data.
// ISTD provides identity; WDSF provides timing/start/finish/notes. Net-new WDSF
// figures are appended. Do not edit by hand — regenerate instead.
import type { DanceId } from "./dances";

export interface LibraryFigureData {
  dance: DanceId;
  figureType: string;
  name: string;
  timing?: string;
  start?: string;
  finish?: string;
  notes?: string[];
}

/** ${rows.length} canonical figures across the five Standard dances. */
export const LIBRARY_FIGURE_DATA: readonly LibraryFigureData[] = [
${body}
];
`;

const outPath = resolve(root, "packages/domain/src/library-data.ts");
writeFileSync(outPath, out);
// Normalise whitespace to satisfy Biome lint/format checks.
execSync(`pnpm exec biome format --write "${outPath}"`, { stdio: "inherit" });
console.log(`wrote ${rows.length} figures to packages/domain/src/library-data.ts`);
