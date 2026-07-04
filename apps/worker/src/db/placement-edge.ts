// Cascade access (2026-06-27): a routine→figure reference edge in D1, so a routine
// co-member can read the figures that routine references. See migration 0006.
import type { EffectiveRole } from "@weavesteps/domain";

/** Record that routine `routineRef` references figure `figureRef` (idempotent). */
export async function linkPlacement(
  db: D1Database,
  routineRef: string,
  figureRef: string,
): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO placement_edge (routineRef, figureRef) VALUES (?, ?)")
    .bind(routineRef, figureRef)
    .run();
}

/**
 * The figure-access cascade derived from the user's role on any routine that
 * references `figureRef`: a routine EDITOR (or owner — whose membership row is
 * `editor`) may EDIT the referenced figure; a commenter/viewer gets read-only
 * VIEWER; a non-member of every referencing routine gets null. Takes the most
 * permissive role across referencing routines. Read-time + order-independent;
 * never grants `owner` (no figure delete). Indexed: placement_edge by figureRef,
 * membership by (userId, deletedAt) / (docRef, userId).
 */
export async function cascadeFigureRole(
  db: D1Database,
  figureRef: string,
  userId: string,
): Promise<EffectiveRole | null> {
  const res = await db
    .prepare(
      "SELECT m.role AS role FROM placement_edge pe JOIN membership m ON m.docRef = pe.routineRef " +
        "WHERE pe.figureRef = ?1 AND m.userId = ?2 AND m.deletedAt IS NULL",
    )
    .bind(figureRef, userId)
    .all<{ role: string }>();
  const roles = res.results ?? [];
  if (roles.length === 0) return null;
  return roles.some((r) => r.role === "editor") ? "editor" : "viewer";
}
