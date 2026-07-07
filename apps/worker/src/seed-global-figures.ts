// ⟳v5 global-figure seeder (PLAN §9 step 3, D28/D30 ⟳). Imports the bundled catalog
// (LIBRARY_FIGURES) into REAL, admin-owned Automerge docs — one DO per
// (dance × figureType), keyed by `globalFigureRef(dance, figureType)`.
//
// D30 ⟳ (owner decision 2026-07-07 — the SEED is authoritative for seeded content):
// the seeder is idempotent and RECONCILING. A figure with no doc yet is imported
// (as before); a figure whose doc exists is reconciled to the current catalog:
// seeded attributes (the deterministic `fig-`/`wdsf-` ids buildWdsfAttributes
// mints) are updated/added/tombstoned to match the seed, while user/admin-ADDED
// attributes (client ULIDs) are preserved and variants keep their owned beats
// (per-beat resolution picks the refreshed base up on unowned beats). A doc that
// already matches the seed persists nothing. So catalog refinements (e.g. the
// WDSF technique-book re-chart) reach every environment by re-running the seeder,
// and existing choreos are enhanced — never broken.
//
// A seeded global doc carries `scope: "global"` (so the DO alarm projects it as
// `global-figure`) + the catalog's charted attributes / alignment / authored count
// length (§2.5.2). Placements reference these docs live (§4.3); a non-admin edit spawns a
// variant that resolves its untouched beats live from the base (§5.2).
import {
  defaultFigureCounts,
  globalFigureRef,
  LIBRARY_FIGURES,
  type LibraryFigure,
} from "@weavesteps/domain";
import { createGlobalFigureRow, updateGlobalFigureRowTitle } from "./db/figures";
import type { Env } from "./index";

export interface SeedGlobalFiguresResult {
  /** Figures whose global doc + D1 row were newly created this run. */
  created: number;
  /** Existing figures whose doc content the reconcile brought up to the seed. */
  updated: number;
  /** Existing figures already matching the seed (nothing persisted). */
  unchanged: number;
  /** Figures that errored (logged; the run continues). */
  skipped: number;
}

/**
 * Create-or-reconcile the global figure docs from the bundled catalog
 * (idempotent). `opts.figures` overrides the source list (tests pass a small
 * subset so a run doesn't seed every DO). Dedupes by `globalFigureRef` so a
 * family with several catalog entries seeds ONE global doc (the first wins —
 * the ref is keyed by (dance, figureType), matching how save-to-library treats
 * it as an idempotency key). Never throws on an individual figure; a per-figure
 * failure is logged and counted as skipped so one bad entry can't abort the run.
 */
export async function seedGlobalFigures(
  env: Env,
  opts?: { figures?: readonly LibraryFigure[] },
): Promise<SeedGlobalFiguresResult> {
  const figures = opts?.figures ?? LIBRARY_FIGURES;
  const seenRefs = new Set<string>();
  const result: SeedGlobalFiguresResult = { created: 0, updated: 0, unchanged: 0, skipped: 0 };

  for (const f of figures) {
    const docRef = globalFigureRef(f.dance, f.figureType);
    if (seenRefs.has(docRef)) continue; // one global doc per (dance, figureType)
    seenRefs.add(docRef);

    try {
      const attributes = f.attributes ?? [];
      // The authored COUNT length (Builder v3 ①): the charted timeline's
      // whole-beat steps, so the editor grid shows the right extent.
      const counts = defaultFigureCounts(attributes);
      // Additive D1 row (INSERT OR IGNORE). A false return = the row already
      // existed → the doc was imported before → reconcile it to the seed.
      const isNew = await createGlobalFigureRow(env.DB, {
        docRef,
        name: f.name,
        dance: f.dance,
        figureType: f.figureType,
      });
      const stub = env.DOC_DO.get(env.DOC_DO.idFromName(docRef));
      if (!isNew) {
        const { changed } = await stub.reconcileSeed({
          name: f.name,
          counts,
          ...(f.entryAlignment ? { entryAlignment: f.entryAlignment } : {}),
          ...(f.exitAlignment ? { exitAlignment: f.exitAlignment } : {}),
          attributes,
        });
        if (changed) {
          // Keep the browse index's display name in step with the seed.
          await updateGlobalFigureRowTitle(env.DB, docRef, f.name);
          result.updated += 1;
        } else {
          result.unchanged += 1;
        }
        continue;
      }

      // seedDoc is itself no-clobber, so even if the D1 row was pruned but the DO
      // survived, the import can't overwrite authored content; the NEXT seeder run
      // will see the existing row and reconcile it instead.
      await stub.seedDoc({
        id: docRef,
        scope: "global",
        ownerId: "app",
        figureType: f.figureType,
        dance: f.dance,
        name: f.name,
        source: "library",
        attributes,
        counts,
        // Charted figure-level entry/exit alignment, where present (buildDoc drops
        // undefined optionals, so an uncharted figure carries neither).
        ...(f.entryAlignment ? { entryAlignment: f.entryAlignment } : {}),
        ...(f.exitAlignment ? { exitAlignment: f.exitAlignment } : {}),
        schemaVersion: 1,
        deletedAt: null,
      });
      result.created += 1;
    } catch (err) {
      console.error("global-figure seed failed", { docRef, err });
      result.skipped += 1;
    }
  }

  return result;
}
