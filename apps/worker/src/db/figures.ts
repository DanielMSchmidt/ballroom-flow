// #187 — figure-doc eager projection to D1 (the figure analog of routines' #129).
//
// When the client mints a figure doc (a custom figure on "Add figure", US-027;
// later a copy-on-write variant, US-035) it must be projected to the D1 index +
// given an owner membership, or the fail-closed DO boundary (US-021) can't
// owner-resolve a connect to that figure → 403. This mirrors createOwnedRoutine.
import { and, count, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { documentRegistry, membership } from "./schema";

export interface NewFigure {
  figureRef: string;
  ownerId: string;
  name: string;
  dance: string;
  figureType: string;
  baseFigureRef?: string | null;
}

/**
 * Eager-create a figure's D1 rows atomically: a registry row (type="account-figure",
 * so it never counts against the owned-ROUTINE quota) + the creator's owner
 * membership (role=editor — same belt-and-suspenders as routines). Idempotent on
 * figureRef so a re-create (or a retried request) is a no-op upsert. The CRDT
 * figure doc itself is seeded by the client into its DO once this lands.
 */
export async function createFigureRows(db: D1Database, f: NewFigure): Promise<void> {
  const now = Date.now();
  const d = drizzle(db);
  await d.batch([
    d
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
      .onConflictDoUpdate({
        target: documentRegistry.docRef,
        set: { title: f.name, updatedAt: now },
      }),
    d
      .insert(membership)
      .values({
        id: `mem_${f.ownerId}_${f.figureRef}`,
        docRef: f.figureRef,
        userId: f.ownerId,
        role: "editor",
        createdAt: now,
      })
      .onConflictDoNothing(),
  ]);
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

/** The caller's account figures (variants + custom) with a usage count from the edges. */
export async function listMineFigures(db: D1Database, userId: string): Promise<MineFigureRow[]> {
  // forkedFromRef carries the figure's baseFigureRef lineage (reused index column,
  // no migration) — surfaced as baseFigureRef so the UI can badge variant vs custom.
  const res = await db
    .prepare(
      "SELECT r.docRef AS docRef, r.figureType AS figureType, r.dance AS dance, r.title AS title, " +
        "r.forkedFromRef AS baseFigureRef, " +
        "(SELECT COUNT(*) FROM placement_edge pe WHERE pe.figureRef = r.docRef) AS usedInCount " +
        "FROM document_registry r WHERE r.ownerId = ?1 AND r.type = 'account-figure' AND r.deletedAt IS NULL " +
        "ORDER BY r.updatedAt DESC",
    )
    .bind(userId)
    .all<MineFigureRow>();
  return res.results ?? [];
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
