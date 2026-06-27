// US-041 — the FigureTypeNoteIndex query (PLAN §2.7, §5.1).
//
// Given a routine's members and its dance, find the thin index rows for their
// figure-family notes that apply to this dance (the family's own dance, or an
// "all dances" note). Content is NOT here — only the index projection; the
// worker route gates the read on co-membership and the client matches each row
// to the figures actually in the routine (resolveFamilyNotesFor).

/** One thin family-note index row (no content). */
export interface FamilyNoteRow {
  noteId: string;
  accountDocRef: string;
  authorId: string;
  figureType: string;
  danceScope: string;
}

/**
 * Family-note index rows authored by any of `authorIds` whose dance scope covers
 * `dance` (the dance itself, or "all"). Excludes tombstoned rows. Returns [] for
 * an empty author set (a routine with no members → no notes).
 */
export async function familyNotesForMembers(
  db: D1Database,
  authorIds: string[],
  dance: string,
): Promise<FamilyNoteRow[]> {
  if (authorIds.length === 0) return [];
  const placeholders = authorIds.map(() => "?").join(",");
  const sql =
    `SELECT noteId, accountDocRef, authorId, figureType, danceScope FROM figure_type_note_index ` +
    `WHERE deletedAt IS NULL AND (danceScope = ? OR danceScope = 'all') ` +
    `AND authorId IN (${placeholders})`;
  const res = await db
    .prepare(sql)
    .bind(dance, ...authorIds)
    .all<FamilyNoteRow>();
  return res.results ?? [];
}
