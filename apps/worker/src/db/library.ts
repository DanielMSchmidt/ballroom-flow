// §2.2/§2.7/§4.2 (⟳v5) — "add to my library" is a per-user BOOKMARK over a
// shared figure doc, never a copy (D28, supersedes the v4.x frozen-copy
// promotion). This module owns the `library_entry` D1 projection (migration
// 0015) that backs it: the account doc's `libraryFigureRefs` set
// (packages/domain/src/doc-account.ts) is the logical source of truth, and this
// table is its list/search projection — mirroring how db/family-notes.ts and
// db/journal.ts project their account-doc-owned content today (the account doc
// is not yet wired to a live DO; see doc-account.ts's STORAGE NOTE).

export interface BookmarkResult {
  /** True when the figureRef was ALREADY a live bookmark for this user (no-op). */
  alreadySaved: boolean;
}

/**
 * Bookmark `figureRef` into `userId`'s library. Idempotent per (userId,
 * figureRef): a live row is a no-op; a previously un-bookmarked (tombstoned) row
 * is revived; otherwise a fresh row is inserted. A lost INSERT race (a concurrent
 * bookmark of the same figure) is resolved as `alreadySaved: true` rather than a
 * throw — the PRIMARY KEY (userId, figureRef) is the real guard, this is just the
 * app-level idempotency contract.
 */
export async function bookmarkFigure(
  db: D1Database,
  userId: string,
  figureRef: string,
): Promise<BookmarkResult> {
  const existing = await db
    .prepare("SELECT deletedAt FROM library_entry WHERE userId = ?1 AND figureRef = ?2")
    .bind(userId, figureRef)
    .first<{ deletedAt: number | null }>();

  if (existing) {
    if (existing.deletedAt == null) return { alreadySaved: true };
    await db
      .prepare(
        "UPDATE library_entry SET deletedAt = NULL, createdAt = ?3 WHERE userId = ?1 AND figureRef = ?2",
      )
      .bind(userId, figureRef, Date.now())
      .run();
    return { alreadySaved: false };
  }

  try {
    await db
      .prepare(
        "INSERT INTO library_entry (userId, figureRef, createdAt, deletedAt) VALUES (?1, ?2, ?3, NULL)",
      )
      .bind(userId, figureRef, Date.now())
      .run();
    return { alreadySaved: false };
  } catch {
    // Lost a concurrent bookmark race (PRIMARY KEY conflict) — the winner's row
    // is already live, so this caller's intent ("have it bookmarked") is met.
    return { alreadySaved: true };
  }
}

/**
 * Un-bookmark `figureRef` for `userId` — tombstones the LibraryEntry ONLY. Never
 * touches the figure doc or any placement referencing it (§5.2): removing a
 * reference is not deleting the shared figure. Idempotent: un-bookmarking an
 * absent/already-removed entry is a no-op (`false`).
 */
export async function unbookmarkFigure(
  db: D1Database,
  userId: string,
  figureRef: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      "UPDATE library_entry SET deletedAt = ?3 WHERE userId = ?1 AND figureRef = ?2 AND deletedAt IS NULL",
    )
    .bind(userId, figureRef, Date.now())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** The live (non-tombstoned) figureRefs `userId` has bookmarked, in no particular order. */
export async function listLibraryFigureRefs(db: D1Database, userId: string): Promise<string[]> {
  const res = await db
    .prepare("SELECT figureRef FROM library_entry WHERE userId = ?1 AND deletedAt IS NULL")
    .bind(userId)
    .all<{ figureRef: string }>();
  return (res.results ?? []).map((r) => r.figureRef);
}

/** Whether `userId` currently has a live bookmark on `figureRef`. */
export async function isBookmarked(
  db: D1Database,
  userId: string,
  figureRef: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS one FROM library_entry WHERE userId = ?1 AND figureRef = ?2 AND deletedAt IS NULL",
    )
    .bind(userId, figureRef)
    .first<{ one: number }>();
  return row != null;
}
