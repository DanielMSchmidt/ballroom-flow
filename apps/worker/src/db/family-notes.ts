// US-041 — the FigureTypeNoteIndex query (PLAN §2.7, §5.1).
//
// Given a routine's members and its dance, find the thin index rows for their
// figure-family notes that apply to this dance (the family's own dance, or an
// "all dances" note). Content is NOT here — only the index projection; the
// worker route gates the read on co-membership and the client matches each row
// to the figures actually in the routine (resolveFamilyNotesFor).

/** One family-note index row (carries content in v1 — see migration 0005).
 *  `count`/`role` are the WEP-0004 TIMED-note fields (migration 0018):
 *  NULL = the untimed v1 whole-figure note. */
export interface FamilyNoteRow {
  noteId: string;
  accountDocRef: string;
  authorId: string;
  figureType: string;
  danceScope: string;
  kind: string;
  text: string;
  count: number | null;
  role: string | null;
}

/** Fields needed to persist a family note. */
export interface FamilyNoteInput {
  noteId: string;
  authorId: string;
  figureType: string;
  danceScope: string;
  kind: string;
  text: string;
  /** WEP-0004: pin to one count (requires a concrete danceScope — the REST
   *  boundary enforces it via zFamilyNoteBody). Omitted = whole figure. */
  count?: number;
  /** WEP-0004: narrow to one side; omitted/null = both. */
  role?: string | null;
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
    `SELECT noteId, accountDocRef, authorId, figureType, danceScope, kind, text, count, role FROM figure_type_note_index ` +
    `WHERE deletedAt IS NULL AND (danceScope = ? OR danceScope = 'all') ` +
    `AND authorId IN (${placeholders})`;
  const res = await db
    .prepare(sql)
    .bind(dance, ...authorIds)
    .all<FamilyNoteRow>();
  return res.results ?? [];
}

/** Persist a family note (server-mediated; accountDocRef = `account:<authorId>`). */
export async function insertFamilyNote(db: D1Database, note: FamilyNoteInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO figure_type_note_index (noteId, accountDocRef, authorId, figureType, danceScope, kind, text, count, role, updatedAt, deletedAt) ` +
        `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      note.noteId,
      `account:${note.authorId}`,
      note.authorId,
      note.figureType,
      note.danceScope,
      note.kind,
      note.text,
      note.count ?? null,
      note.role ?? null,
      Date.now(),
    )
    .run();
}
