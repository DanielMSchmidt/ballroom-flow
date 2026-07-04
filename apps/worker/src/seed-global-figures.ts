// ⟳v5 global-figure seeder (PLAN §9 step 3, D28/D30). Imports the bundled catalog
// (LIBRARY_FIGURES) into REAL, admin-owned Automerge docs — one DO per
// (dance × figureType), keyed by `globalFigureRef(dance, figureType)`.
//
// D30 (the doc is the source of truth after import): the seeder is ADDITIVE and
// IDEMPOTENT — it only creates docs that don't exist yet and NEVER overwrites an
// existing one (the D1 row is `INSERT OR IGNORE`; the DO `seedDoc` no-clobbers any
// persisted content). Re-running only fills gaps (e.g. a catalog that grew), so
// admin in-app edits to a seeded figure are safe from a re-seed.
//
// A seeded global doc carries `scope: "global"` (so the DO alarm projects it as
// `global-figure`) + the catalog's charted attributes / alignment / authored bar
// length. Placements reference these docs live (§4.3); a non-admin edit spawns a
// variant that resolves its untouched beats live from the base (§5.2).
import {
  defaultFigureBars,
  globalFigureRef,
  LIBRARY_FIGURES,
  type LibraryFigure,
} from "@ballroom/domain";
import { createGlobalFigureRow } from "./db/figures";
import type { Env } from "./index";

export interface SeedGlobalFiguresResult {
  /** Figures whose global doc + D1 row were newly created this run. */
  created: number;
  /** Figures whose global doc already existed (left untouched — D30). */
  skipped: number;
}

/**
 * Create the global figure docs from the bundled catalog (additive, idempotent).
 * `opts.figures` overrides the source list (tests pass a small subset so a run
 * doesn't seed all 241 DOs). Dedupes by `globalFigureRef` so a family with several
 * catalog entries seeds ONE global doc (the first wins — the ref is keyed by
 * (dance, figureType), matching how save-to-library treats it as an idempotency
 * key). Never throws on an individual figure; a per-figure failure is logged and
 * counted as skipped so one bad entry can't abort the whole import.
 */
export async function seedGlobalFigures(
  env: Env,
  opts?: { figures?: readonly LibraryFigure[] },
): Promise<SeedGlobalFiguresResult> {
  const figures = opts?.figures ?? LIBRARY_FIGURES;
  const seenRefs = new Set<string>();
  let created = 0;
  let skipped = 0;

  for (const f of figures) {
    const docRef = globalFigureRef(f.dance, f.figureType);
    if (seenRefs.has(docRef)) continue; // one global doc per (dance, figureType)
    seenRefs.add(docRef);

    try {
      // Additive D1 row (INSERT OR IGNORE). A false return = the row already
      // existed → this figure was seeded before; leave its DO untouched (D30).
      const isNew = await createGlobalFigureRow(env.DB, {
        docRef,
        name: f.name,
        dance: f.dance,
        figureType: f.figureType,
      });
      if (!isNew) {
        skipped += 1;
        continue;
      }

      const attributes = f.attributes ?? [];
      // seedDoc is itself no-clobber, so even if the D1 row was pruned but the DO
      // survived, the authored content is never overwritten (D30).
      await env.DOC_DO.get(env.DOC_DO.idFromName(docRef)).seedDoc({
        id: docRef,
        scope: "global",
        ownerId: "app",
        figureType: f.figureType,
        dance: f.dance,
        name: f.name,
        source: "library",
        attributes,
        // The authored bar length (PLAN §2.5.2): ⌈whole-beat steps ÷ beatsPerBar⌉
        // from the charted timeline, so the editor grid shows the right extent.
        bars: defaultFigureBars(attributes, f.dance),
        // Charted figure-level entry/exit alignment, where present (buildDoc drops
        // undefined optionals, so an uncharted figure carries neither).
        ...(f.entryAlignment ? { entryAlignment: f.entryAlignment } : {}),
        ...(f.exitAlignment ? { exitAlignment: f.exitAlignment } : {}),
        schemaVersion: 1,
        deletedAt: null,
      });
      created += 1;
    } catch (err) {
      console.error("global-figure seed failed", { docRef, err });
      skipped += 1;
    }
  }

  return { created, skipped };
}
