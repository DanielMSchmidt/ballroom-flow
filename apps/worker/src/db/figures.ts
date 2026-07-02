// #187 — figure-doc eager projection to D1 (the figure analog of routines' #129).
//
// When the client mints a figure doc (a custom figure on "Add figure", US-027;
// later a copy-on-write variant, US-035) it must be projected to the D1 index +
// given an owner membership, or the fail-closed DO boundary (US-021) can't
// owner-resolve a connect to that figure → 403. This mirrors createOwnedRoutine.
import { LIBRARY_FIGURES, parseGlobalFigureRef } from "@ballroom/domain";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { listLibraryFigureRefs } from "./library";
import { documentRegistry, membership } from "./schema";

export interface NewFigure {
  figureRef: string;
  ownerId: string;
  name: string;
  dance: string;
  figureType: string;
  baseFigureRef?: string | null;
}

export type CreateFigureResult = "ok" | "owner_conflict";

/**
 * Eager-create a figure's D1 rows: a registry row (type="account-figure", so it
 * never counts against the owned-ROUTINE quota) + the creator's owner membership
 * (role=editor — same belt-and-suspenders as routines). Idempotent on figureRef
 * for the SAME owner (a retried request is a no-op). The CRDT figure doc itself
 * is seeded into its DO once this lands.
 *
 * AUTHZ (2026-07-02 review): this must never be an upsert. Posting an EXISTING
 * figureRef owned by someone else previously (a) rewrote the victim's registry
 * title and (b) inserted the CALLER's editor membership on the victim's doc — a
 * viewer→editor escalation, since figureRefs leak to every viewer of any shared
 * routine. Now: guarded insert (`onConflictDoNothing`), then re-read the row —
 * if it belongs to a different owner, report `owner_conflict` and write NOTHING
 * else (the insert-then-check order stays race-safe: the loser of a concurrent
 * insert sees the winner's ownerId on the re-read).
 */
export async function createFigureRows(db: D1Database, f: NewFigure): Promise<CreateFigureResult> {
  const now = Date.now();
  const d = drizzle(db);
  await d
    .insert(documentRegistry)
    .values({
      docRef: f.figureRef,
      type: "account-figure",
      ownerId: f.ownerId,
      doName: f.figureRef,
      title: f.name,
      dance: f.dance,
      figureType: f.figureType,
      // forkedFromRef carries the figure's baseFigureRef lineage (reused index
      // column, no migration) — a variant has a base, a custom figure is null.
      forkedFromRef: f.baseFigureRef ?? null,
      updatedAt: now,
    })
    .onConflictDoNothing();
  const row = await d
    .select({ ownerId: documentRegistry.ownerId })
    .from(documentRegistry)
    .where(eq(documentRegistry.docRef, f.figureRef))
    .get();
  if (!row || row.ownerId !== f.ownerId) return "owner_conflict"; // fail closed
  await d
    .insert(membership)
    .values({
      id: `mem_${f.ownerId}_${f.figureRef}`,
      docRef: f.figureRef,
      userId: f.ownerId,
      role: "editor",
      createdAt: now,
    })
    .onConflictDoNothing();
  return "ok";
}

export interface GlobalFigureRow {
  docRef: string;
  figureType: string | null;
  dance: string | null;
  title: string | null;
}

/** Global (app-owned) library figures from the index, optionally dance-filtered. */
export async function listGlobalFigures(
  db: D1Database,
  dance?: string,
): Promise<GlobalFigureRow[]> {
  const sql = dance
    ? "SELECT docRef, figureType, dance, title FROM document_registry WHERE type = 'global-figure' AND deletedAt IS NULL AND dance = ?1 ORDER BY figureType, title"
    : "SELECT docRef, figureType, dance, title FROM document_registry WHERE type = 'global-figure' AND deletedAt IS NULL ORDER BY figureType, title";
  const stmt = dance ? db.prepare(sql).bind(dance) : db.prepare(sql);
  const res = await stmt.all<GlobalFigureRow>();
  return res.results ?? [];
}

export interface MineFigureRow extends GlobalFigureRow {
  baseFigureRef: string | null;
  usedInCount: number;
}

/**
 * The caller's LIBRARY — their bookmarked figures (⟳v5, §4.2/§5.2, D28), driven
 * by `library_entry` (the LibraryEntry projection, §2.7), NOT ownership: a
 * choreo-local account figure with no bookmark must NOT appear here, and a
 * bookmarked figure a CO-MEMBER created (e.g. your partner's shared-choreo
 * figure) DOES — the library is a set of references, not a set of owned docs.
 *
 * A bookmark resolves one of two ways:
 *  - an account-figure docRef  → joined against `document_registry` for its
 *    title/dance/figureType/lineage (`baseFigureRef`, carried in the reused
 *    `forkedFromRef` column) + its usedInCount from `placement_edge`.
 *  - a catalog `global:<dance>:<figureType>` ref (bookmarked straight off the
 *    global library, no copy) → has no registry row of its own; resolved from
 *    the bundled `LIBRARY_FIGURES` reference data instead. Its `baseFigureRef`
 *    is null (it's the catalog original, not a variant of anything) and its
 *    `usedInCount` reads `placement_edge` the same way — 0 until a live catalog
 *    reference is placed (global figure docs/live catalog placements land in the
 *    v5 milestone's step 3).
 */
export async function listMineFigures(db: D1Database, userId: string): Promise<MineFigureRow[]> {
  const refs = await listLibraryFigureRefs(db, userId);
  if (refs.length === 0) return [];

  const accountRefs = refs.filter((r) => parseGlobalFigureRef(r) == null);
  const catalogRefs = refs.filter((r) => parseGlobalFigureRef(r) != null);

  const rows: MineFigureRow[] = [];

  if (accountRefs.length > 0) {
    // forkedFromRef carries the figure's baseFigureRef lineage (reused index
    // column, no migration) — surfaced as baseFigureRef so the UI can badge
    // variant vs custom. docRef is the PRIMARY KEY, so `IN (...)` is an indexed
    // lookup, not a scan.
    const placeholders = accountRefs.map((_, i) => `?${i + 2}`).join(",");
    const res = await db
      .prepare(
        "SELECT r.docRef AS docRef, r.figureType AS figureType, r.dance AS dance, r.title AS title, " +
          "r.forkedFromRef AS baseFigureRef, " +
          "(SELECT COUNT(*) FROM placement_edge pe WHERE pe.figureRef = r.docRef) AS usedInCount " +
          `FROM document_registry r WHERE r.type = ?1 AND r.deletedAt IS NULL AND r.docRef IN (${placeholders}) ` +
          "ORDER BY r.updatedAt DESC",
      )
      .bind("account-figure", ...accountRefs)
      .all<MineFigureRow>();
    rows.push(...(res.results ?? []));
  }

  for (const ref of catalogRefs) {
    const parsed = parseGlobalFigureRef(ref);
    if (!parsed) continue; // narrows for TS; catalogRefs is already filtered
    const catalog = LIBRARY_FIGURES.find(
      (f) => f.dance === parsed.dance && f.figureType === parsed.figureType,
    );
    const used = await db
      .prepare("SELECT COUNT(*) AS n FROM placement_edge WHERE figureRef = ?1")
      .bind(ref)
      .first<{ n: number }>();
    rows.push({
      docRef: ref,
      figureType: parsed.figureType,
      dance: parsed.dance,
      title: catalog?.name ?? parsed.figureType,
      baseFigureRef: null, // the catalog original, not a variant of anything
      usedInCount: used?.n ?? 0,
    });
  }

  return rows;
}

/**
 * Batch-resolve each `docRef`'s registry `type` (§2.7) — used by the v5 fork
 * flow (fork.ts) to tell an ACCOUNT figure ref (copy it for the forker) apart
 * from a GLOBAL (catalog) ref (leave it live) or a ref with no registry row at
 * all (a dangling/legacy reference — left untouched, there's nothing to copy).
 * Chunked at 100 refs/query — D1's bound-parameter cap — since a routine can
 * reference dozens of figures; still just one or two round-trips in practice.
 */
export async function getRegistryTypes(
  db: D1Database,
  docRefs: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (docRefs.length === 0) return out;
  const d = drizzle(db);
  const CHUNK = 100;
  for (let i = 0; i < docRefs.length; i += CHUNK) {
    const chunk = docRefs.slice(i, i + CHUNK);
    const rows = await d
      .select({ docRef: documentRegistry.docRef, type: documentRegistry.type })
      .from(documentRegistry)
      .where(inArray(documentRegistry.docRef, chunk));
    for (const r of rows) out.set(r.docRef, r.type);
  }
  return out;
}

/**
 * The caller's existing account-figure derived FROM a given base figure,
 * identified by its `baseFigureRef` lineage (stored in the reused
 * `forkedFromRef` column). Returns the derivative's docRef, or null. ⟳v5: the
 * bookmark model no longer creates copies on save-to-library, but the FORK
 * path still mints per-forker figure copies and uses this to resolve the
 * `account_figure_base_idx` unique-index collision (at most one derivative per
 * `(owner, base)`) by REUSING the forker's existing derivative — see
 * apps/worker/src/fork.ts (v5 milestone step 5). Scoped to the owner so it
 * never reads another user's figure.
 */
export async function findSavedLibraryFigure(
  db: D1Database,
  userId: string,
  baseFigureRef: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT docRef FROM document_registry WHERE ownerId = ?1 AND type = 'account-figure' " +
        "AND forkedFromRef = ?2 AND deletedAt IS NULL LIMIT 1",
    )
    .bind(userId, baseFigureRef)
    .first<{ docRef: string }>();
  return row?.docRef ?? null;
}

/** Count a user's OWNED figures (for tests/quota separation — figures are uncapped). */
export async function countOwnedFigures(db: D1Database, userId: string): Promise<number> {
  const row = await drizzle(db)
    .select({ n: count() })
    .from(documentRegistry)
    .where(
      and(
        eq(documentRegistry.ownerId, userId),
        eq(documentRegistry.type, "account-figure"),
        isNull(documentRegistry.deletedAt),
      ),
    )
    .get();
  return row?.n ?? 0;
}
