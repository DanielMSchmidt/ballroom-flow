// Cascade access (2026-06-27): a routine→figure reference edge in D1, so a routine
// co-member can read the figures that routine references. See migration 0006.
import type { EffectiveRole } from "@ballroom/domain";

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
 * The figure-access cascade: VIEWER if `userId` is an active member of ANY routine
 * that references `figureRef`, else null. Read-time + order-independent — never
 * escalates edit rights (editing a figure needs direct ownership / future COW).
 * Indexed: placement_edge by figureRef, membership by (userId, deletedAt).
 */
export async function cascadeFigureRole(
  db: D1Database,
  figureRef: string,
  userId: string,
): Promise<EffectiveRole | null> {
  const row = await db
    .prepare(
      "SELECT 1 AS ok FROM placement_edge WHERE figureRef = ?1 AND routineRef IN " +
        "(SELECT docRef FROM membership WHERE userId = ?2 AND deletedAt IS NULL) LIMIT 1",
    )
    .bind(figureRef, userId)
    .first<{ ok: number }>();
  return row ? "viewer" : null;
}
