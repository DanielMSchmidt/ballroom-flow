// #187 — figure-doc eager projection to D1 (the figure analog of routines' #129).
//
// When the client mints a figure doc (a custom figure on "Add figure", US-027;
// later a copy-on-write variant, US-035) it must be projected to the D1 index +
// given an owner membership, or the fail-closed DO boundary (US-021) can't
// owner-resolve a connect to that figure → 403. This mirrors createOwnedRoutine.
import type { FigureListItem } from "@ballroom/contract";
import type { DanceId } from "@ballroom/domain";
import { and, count, countDistinct, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { documentRegistry, figureUsage, membership } from "./schema";

export interface NewFigure {
  figureRef: string;
  ownerId: string;
  name: string;
  dance: string;
  figureType: string;
}

/**
 * Eager-create a figure's D1 rows atomically: a registry row (type="figure", so
 * it never counts against the owned-ROUTINE quota) + the creator's owner
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
        type: "figure",
        ownerId: f.ownerId,
        doName: f.figureRef,
        title: f.name,
        dance: f.dance,
        figureType: f.figureType,
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

/**
 * The application-global figure library (US-032): app-owned canonical figures,
 * optionally filtered by dance, served by `document_registry_type_idx`
 * (type, dance, deletedAt) — no CRDT scan. Grouping by `figureType` is the
 * client's concern; this returns a flat, projected list. `scope` is always
 * "global" here.
 */
export async function listGlobalFigures(
  db: D1Database,
  dance?: DanceId,
): Promise<FigureListItem[]> {
  const d = drizzle(db);
  const where = dance
    ? and(
        eq(documentRegistry.type, "global-figure"),
        eq(documentRegistry.dance, dance),
        isNull(documentRegistry.deletedAt),
      )
    : and(eq(documentRegistry.type, "global-figure"), isNull(documentRegistry.deletedAt));
  const rows = await d
    .select({
      docRef: documentRegistry.docRef,
      title: documentRegistry.title,
      figureType: documentRegistry.figureType,
      dance: documentRegistry.dance,
    })
    .from(documentRegistry)
    .where(where)
    .all();
  return rows.map((r) => ({
    docRef: r.docRef,
    name: r.title ?? r.figureType ?? r.docRef,
    figureType: r.figureType ?? r.docRef,
    dance: (r.dance ?? "waltz") as DanceId,
    scope: "global" as const,
  }));
}

/**
 * The viewer's account figures (US-033): variants + custom figures they own,
 * each with "used in N routines" (distinct referencing routines via the
 * `figure_usage` edge index) and, for a variant, the base figure's name
 * (lineage). Variant-vs-custom keys on the base link (`forkedFromRef`), NOT
 * `source` (#56) — a copy-on-write variant also carries source="custom".
 *
 * Three indexed reads merged in memory (the listRoutines pattern): the owned
 * account-figures (owner_idx), their usage counts (figure_usage_figure_idx),
 * and the base titles (registry PK). D1 is a pure index — never a CRDT read.
 */
export async function listMyFigures(db: D1Database, userId: string): Promise<FigureListItem[]> {
  const d = drizzle(db);
  const rows = await d
    .select({
      docRef: documentRegistry.docRef,
      title: documentRegistry.title,
      figureType: documentRegistry.figureType,
      dance: documentRegistry.dance,
      baseRef: documentRegistry.forkedFromRef,
    })
    .from(documentRegistry)
    .where(
      and(
        eq(documentRegistry.ownerId, userId),
        eq(documentRegistry.type, "account-figure"),
        isNull(documentRegistry.deletedAt),
      ),
    )
    .all();
  if (rows.length === 0) return [];

  // Usage counts for exactly these figures (one grouped, indexed read).
  const figureRefs = rows.map((r) => r.docRef);
  const usageRows = await d
    .select({ figureRef: figureUsage.figureRef, n: countDistinct(figureUsage.routineRef) })
    .from(figureUsage)
    .where(and(inArray(figureUsage.figureRef, figureRefs), isNull(figureUsage.deletedAt)))
    .groupBy(figureUsage.figureRef)
    .all();
  const usage = new Map(usageRows.map((u) => [u.figureRef, u.n]));

  // Base figure names for the variants' lineage (one PK read).
  const baseRefs = rows.map((r) => r.baseRef).filter((b): b is string => b != null);
  const baseNames = new Map<string, string>();
  if (baseRefs.length > 0) {
    const bases = await d
      .select({ docRef: documentRegistry.docRef, title: documentRegistry.title })
      .from(documentRegistry)
      .where(inArray(documentRegistry.docRef, baseRefs))
      .all();
    for (const b of bases) if (b.title) baseNames.set(b.docRef, b.title);
  }

  return rows.map((r) => ({
    docRef: r.docRef,
    name: r.title ?? r.figureType ?? r.docRef,
    figureType: r.figureType ?? r.docRef,
    dance: (r.dance ?? "waltz") as DanceId,
    // A base link makes it a variant; otherwise a from-scratch custom figure (#56).
    scope: r.baseRef ? ("variant" as const) : ("custom" as const),
    baseName: r.baseRef ? (baseNames.get(r.baseRef) ?? null) : null,
    usedInCount: usage.get(r.docRef) ?? 0,
  }));
}

/** Count a user's OWNED figures (for tests/quota separation — figures are uncapped). */
export async function countOwnedFigures(db: D1Database, userId: string): Promise<number> {
  const row = await drizzle(db)
    .select({ n: count() })
    .from(documentRegistry)
    .where(
      and(
        eq(documentRegistry.ownerId, userId),
        eq(documentRegistry.type, "figure"),
        isNull(documentRegistry.deletedAt),
      ),
    )
    .get();
  return row?.n ?? 0;
}
