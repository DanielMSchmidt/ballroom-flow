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
  /** The row's last-write time (v1 index tracks no separate createdAt). Surfaced
   *  so the reading-view margin can order co-members' notes newest-first. */
  updatedAt: number;
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
    `SELECT noteId, accountDocRef, authorId, figureType, danceScope, kind, text, count, role, updatedAt FROM figure_type_note_index ` +
    `WHERE deletedAt IS NULL AND (danceScope = ? OR danceScope = 'all') ` +
    `AND authorId IN (${placeholders})`;
  const res = await db
    .prepare(sql)
    .bind(dance, ...authorIds)
    .all<FamilyNoteRow>();
  return res.results ?? [];
}

/** One projected family-note row (WEP-0002): the account doc's figureType
 *  annotation, tombstone carried, projected to `figure_type_note_index`. */
export interface FamilyNoteProjection {
  noteId: string;
  authorId: string;
  figureType: string;
  danceScope: string;
  kind: string;
  text: string;
  count: number | null;
  role: string | null;
  deletedAt: number | null;
}

/**
 * Project the account doc's `figureType` annotations to `figure_type_note_index`
 * (WEP-0002 — the alarm-written inversion of insertFamilyNote's direct write).
 * Stable-key upsert on the reused ULID `noteId`, so this is idempotent and never
 * a wipe-and-rewrite; a tombstoned annotation carries its `deletedAt` through, so
 * a delete projects as a tombstone (never a hard removal). Non-destructive: rows
 * for notes still present in the doc are upserted in place.
 */
export async function projectFamilyNotes(
  db: D1Database,
  notes: FamilyNoteProjection[],
): Promise<void> {
  if (notes.length === 0) return;
  const now = Date.now();
  const stmts = notes.map((n) =>
    db
      .prepare(
        `INSERT INTO figure_type_note_index (noteId, accountDocRef, authorId, figureType, danceScope, kind, text, count, role, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(noteId) DO UPDATE SET
           accountDocRef = excluded.accountDocRef, authorId = excluded.authorId,
           figureType = excluded.figureType, danceScope = excluded.danceScope,
           kind = excluded.kind, text = excluded.text, count = excluded.count,
           role = excluded.role, updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt`,
      )
      .bind(
        n.noteId,
        `account:${n.authorId}`,
        n.authorId,
        n.figureType,
        n.danceScope,
        n.kind,
        n.text,
        n.count,
        n.role,
        now,
        n.deletedAt,
      ),
  );
  await db.batch(stmts);
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
