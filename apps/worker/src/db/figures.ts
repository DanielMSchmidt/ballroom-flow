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
