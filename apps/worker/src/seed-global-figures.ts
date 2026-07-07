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
// `global-figure`) + the catalog's charted attributes / alignment / authored bar
// length. Placements reference these docs live (§4.3); a non-admin edit spawns a
// variant that resolves its untouched beats live from the base (§5.2).
import {
  defaultFigureBars,
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
      const bars = defaultFigureBars(attributes, f.dance);
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
          bars,
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
        // The authored bar length (PLAN §2.5.2): ⌈whole-beat steps ÷ beatsPerBar⌉
        // from the charted timeline, so the editor grid shows the right extent.
        bars,
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

// ─────────────────────────────────────────────────────────────────────────
// Hash-guarded self-healing (D30 ⟳, owner decision 2026-07-07): the seeder runs
// ITSELF whenever the bundled catalog and the environment disagree — no admin
// endpoint, no deploy step to forget. A SHA-256 of the seed-relevant catalog
// content is compared against the `app_meta` row the last successful run wrote;
// on mismatch (new deploy content, fresh environment, or a wiped D1) the
// reconcile runs. Invoked fire-and-forget from the /api/* seam with a short
// in-isolate throttle so the steady state costs one PK SELECT per THROTTLE_MS
// per isolate — and, following the ensureSample precedent, the authority is
// ACTUAL D1 state, never a stale module boolean.
// ─────────────────────────────────────────────────────────────────────────

const SEED_HASH_KEY = "global_figure_seed_hash";
const THROTTLE_MS = 30_000;

/** Hash exactly the content the reconcile enforces, so a deploy that doesn't
 *  touch the catalog is a guaranteed no-op. */
async function seedContentHash(figures: readonly LibraryFigure[]): Promise<string> {
  const payload = figures.map((f) => [
    globalFigureRef(f.dance, f.figureType),
    f.name,
    f.entryAlignment ?? null,
    f.exitAlignment ?? null,
    f.attributes ?? [],
  ]);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Memoized hash of the DEFAULT bundle (constant per isolate) + the in-isolate
// throttle/stampede state. Only timing state lives in the module — the seeded-or-
// not decision always comes from D1.
let bundleHash: Promise<string> | undefined;
let lastCheckAt = 0;
let inFlight: Promise<EnsureGlobalFiguresResult> | undefined;

export interface EnsureGlobalFiguresResult {
  /** Whether the seeder actually ran (the stored hash was absent or stale). */
  ran: boolean;
  result?: SeedGlobalFiguresResult;
}

/**
 * Reconcile the global figure docs to the bundled catalog IF the environment's
 * stored seed hash disagrees. Cheap when current (one indexed PK SELECT, at most
 * every THROTTLE_MS per isolate); the hash is persisted only after a run with no
 * per-figure errors, so a partial failure retries on the next check. Concurrent
 * calls within an isolate share one run; cross-isolate overlap is safe (the
 * reconcile is idempotent and each doc's DO serializes its own writes).
 * `opts.figures` (tests) bypasses the memoized bundle hash and the throttle.
 */
export async function ensureGlobalFigures(
  env: Env,
  opts?: { figures?: readonly LibraryFigure[] },
): Promise<EnsureGlobalFiguresResult> {
  const now = Date.now();
  if (!opts?.figures) {
    if (inFlight) return inFlight;
    if (now - lastCheckAt < THROTTLE_MS) return { ran: false };
    lastCheckAt = now;
  }
  const run = (async (): Promise<EnsureGlobalFiguresResult> => {
    try {
      const figures = opts?.figures ?? LIBRARY_FIGURES;
      if (!opts?.figures && !bundleHash) bundleHash = seedContentHash(LIBRARY_FIGURES);
      const hash = opts?.figures ? await seedContentHash(figures) : await bundleHash;
      if (!hash) return { ran: false }; // unreachable; satisfies the narrower type
      const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?")
        .bind(SEED_HASH_KEY)
        .first<{ value: string }>();
      if (row?.value === hash) return { ran: false };

      const result = await seedGlobalFigures(env, opts);
      if (result.skipped === 0) {
        await env.DB.prepare(
          "INSERT INTO app_meta (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt",
        )
          .bind(SEED_HASH_KEY, hash, Date.now())
          .run();
      }
      return { ran: true, result };
    } catch (err) {
      console.error("global-figure ensure failed", err);
      return { ran: false };
    }
  })();
  if (!opts?.figures) {
    inFlight = run;
    run.finally(() => {
      inFlight = undefined;
    });
  }
  return run;
}
