// T6 — the cross-routine Journal index query + projection (PLAN §2.6/§2.7/§6).
//
// `journal_entry` (migration 0009) is the DERIVED projection of a routine doc's
// lesson/practice annotations, written by the routine DO's alarm (projectJournal
// in doc-do.ts). The Journal read (`GET /api/journal`) UNIONs it with the
// account-scoped figureType lesson/practice rows in `figure_type_note_index`.
//
// Visibility (T6 LOCKED): BOTH arms are gated to the signed-in user PLUS their
// co-members on shared routines:
//   • routine arm — the routine-accessibility gate (member/owner of the routine),
//     so a co-member's (e.g. the coach's) entry surfaces (author-coloured cards).
//   • account arm — the accessible-AUTHORS set (self + every co-member/owner of
//     any routine the user can access), symmetric with familyNotesForMembers.
//
// D1 stays a pure index; the routine doc (DO SQLite) is the source of truth.

/** One row to upsert into `journal_entry` (the DO projection's output). */
export interface JournalEntryProjection {
  entryId: string;
  authorId: string;
  kind: string;
  text: string;
  /** JSON-encoded Anchor[] (each anchor carries a resolved `label`). */
  anchors: string;
  createdAt: number;
  /** Soft-delete tombstone mirrored from the annotation (null = live). */
  deletedAt: number | null;
}

/** A journal entry as the read returns it (anchors parsed, author joined). */
export interface JournalEntryOut {
  id: string;
  routineRef: string;
  authorId: string;
  kind: string;
  text: string;
  anchors: Array<Record<string, unknown>>;
  createdAt: number;
  displayName: string | null;
  identityColor: string | null;
  source: "routine" | "account";
}

/**
 * Upsert a routine's projected lesson/practice entries (scoped to `routineRef`).
 * `deletedAt` is mirrored from the annotation so a soft-deleted annotation flips
 * its row (idempotent re-projection; the read filters tombstones out).
 */
export async function projectJournalEntries(
  db: D1Database,
  routineRef: string,
  rows: JournalEntryProjection[],
): Promise<void> {
  if (rows.length === 0) return;
  const now = Date.now();
  const stmts = rows.map((r) =>
    db
      .prepare(
        `INSERT INTO journal_entry (entryId, routineRef, authorId, kind, text, anchors, createdAt, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(entryId) DO UPDATE SET
           routineRef = excluded.routineRef, authorId = excluded.authorId, kind = excluded.kind,
           text = excluded.text, anchors = excluded.anchors, createdAt = excluded.createdAt,
           updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt`,
      )
      .bind(
        r.entryId,
        routineRef,
        r.authorId,
        r.kind,
        r.text,
        r.anchors,
        r.createdAt,
        now,
        r.deletedAt,
      ),
  );
  await db.batch(stmts);
}

/** Title-case a figureType/dance slug for a chip label ("natural_turn" → "Natural Turn"). */
function humanize(slug: string): string {
  return slug
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The chip label for a figureType anchor: "all Whisks · all Waltz" / "· all
 *  dances"; a TIMED note (WEP-0004) appends its pinned count ("· count 3"). */
export function figureTypeLabel(
  figureType: string,
  danceScope: string,
  count?: number | null,
): string {
  const family = `all ${humanize(figureType)}s`;
  const scope = danceScope === "all" ? "all dances" : `all ${humanize(danceScope)}`;
  return count != null ? `${family} · ${scope} · count ${count}` : `${family} · ${scope}`;
}

/** Parse a stored anchors JSON blob defensively (bad/empty → []). */
function parseAnchors(raw: string): Array<Record<string, unknown>> {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function bindAll<T>(db: D1Database, sql: string, binds: unknown[]): Promise<T[]> {
  const res = await db
    .prepare(sql)
    .bind(...binds)
    .all<T>();
  return res.results ?? [];
}

/**
 * The signed-in user's journal: routine-scoped + account-scoped lesson/practice
 * entries, newest-first, tombstones excluded, author display/colour joined.
 */
interface AccountNoteRow {
  id: string;
  routineRef: string;
  authorId: string;
  kind: string;
  text: string;
  figureType: string;
  danceScope: string;
  /** WEP-0004 timed-note fields (migration 0018); NULL = untimed v1 note. */
  count: number | null;
  role: string | null;
  createdAt: number;
  displayName: string | null;
  identityColor: string | null;
}

export async function journalForUser(db: D1Database, userId: string): Promise<JournalEntryOut[]> {
  // The ROUTINES the user can access (member rows restricted to type='routine' +
  // owned-without-membership, the #168 owner arm) — consistent with
  // resolveEffectiveRole; a shared account-figure membership is never a routine.
  const accessible = await bindAll<{ docRef: string }>(
    db,
    `SELECT m.docRef FROM membership m
       JOIN document_registry r ON r.docRef = m.docRef AND r.type = 'routine' AND r.deletedAt IS NULL
       WHERE m.userId = ? AND m.deletedAt IS NULL
     UNION
     SELECT docRef FROM document_registry WHERE ownerId = ? AND type = 'routine' AND deletedAt IS NULL`,
    [userId, userId],
  );
  const routineRefs = accessible.map((r) => r.docRef);

  // (a) routine-scoped entries for those routines (NOT author-filtered → a
  //     co-member's entry surfaces, which is what makes the cards author-coloured).
  let routineRows: Array<{
    id: string;
    routineRef: string;
    authorId: string;
    kind: string;
    text: string;
    anchors: string;
    createdAt: number;
    displayName: string | null;
    identityColor: string | null;
  }> = [];
  if (routineRefs.length > 0) {
    const ph = routineRefs.map(() => "?").join(",");
    routineRows = await bindAll(
      db,
      `SELECT j.entryId AS id, j.routineRef, j.authorId, j.kind, j.text, j.anchors, j.createdAt,
              u.displayName, u.identityColor
       FROM journal_entry j
       LEFT JOIN users u ON u.id = j.authorId
       WHERE j.deletedAt IS NULL AND j.routineRef IN (${ph})`,
      routineRefs,
    );
  }

  // (b) account-scoped figureType lesson/practice entries. Two strictly-bounded
  //     arms, deduped — NO broad author set (T6 LOCKED #2 ≡ the family-note model):
  //   • the user's OWN figureType lesson/practice notes (their personal cross-dance
  //     journal — their own data, always shown), and
  //   • a CO-MEMBER's figureType note ONLY when that family appears in a routine the
  //     user shares with the author and the danceScope covers that routine's dance —
  //     symmetric with familyNotesForMembers (db/family-notes.ts). This does not
  //     expand the family-note privacy model.
  const ownNotes = await bindAll<AccountNoteRow>(
    db,
    `SELECT f.noteId AS id, f.accountDocRef AS routineRef, f.authorId, f.kind, f.text,
            f.figureType, f.danceScope, f.count, f.role, f.updatedAt AS createdAt,
            u.displayName, u.identityColor
     FROM figure_type_note_index f
     LEFT JOIN users u ON u.id = f.authorId
     WHERE f.deletedAt IS NULL AND f.kind IN ('lesson','practice') AND f.authorId = ?`,
    [userId],
  );
  const sharedNotes = await bindAll<AccountNoteRow>(
    db,
    `SELECT DISTINCT f.noteId AS id, f.accountDocRef AS routineRef, f.authorId, f.kind, f.text,
            f.figureType, f.danceScope, f.count, f.role, f.updatedAt AS createdAt,
            u.displayName, u.identityColor
     FROM figure_type_note_index f
     JOIN membership ma ON ma.userId = f.authorId AND ma.deletedAt IS NULL
     JOIN membership me ON me.docRef = ma.docRef AND me.userId = ? AND me.deletedAt IS NULL
     JOIN document_registry rt ON rt.docRef = ma.docRef AND rt.type = 'routine' AND rt.deletedAt IS NULL
     JOIN placement_edge pe ON pe.routineRef = rt.docRef
     JOIN document_registry fig ON fig.docRef = pe.figureRef AND fig.figureType = f.figureType
     LEFT JOIN users u ON u.id = f.authorId
     WHERE f.deletedAt IS NULL AND f.kind IN ('lesson','practice')
       AND (f.danceScope = rt.dance OR f.danceScope = 'all')`,
    [userId],
  );
  const accountById = new Map<string, AccountNoteRow>();
  for (const r of [...ownNotes, ...sharedNotes]) accountById.set(r.id, r);
  const accountRows = [...accountById.values()];

  const entries: JournalEntryOut[] = [
    ...routineRows.map((r) => ({
      id: r.id,
      routineRef: r.routineRef,
      authorId: r.authorId,
      kind: r.kind,
      text: r.text,
      anchors: parseAnchors(r.anchors),
      createdAt: r.createdAt,
      displayName: r.displayName,
      identityColor: r.identityColor,
      source: "routine" as const,
    })),
    ...accountRows.map((r) => ({
      id: r.id,
      routineRef: r.routineRef,
      authorId: r.authorId,
      kind: r.kind,
      text: r.text,
      anchors: [
        {
          type: "figureType",
          figureType: r.figureType,
          danceScope: r.danceScope,
          // WEP-0004: a timed note carries its count/role so the client can pin
          // it; keys stay absent on the untimed v1 corpus.
          ...(r.count != null ? { count: r.count } : {}),
          ...(r.role != null ? { role: r.role } : {}),
          label: figureTypeLabel(r.figureType, r.danceScope, r.count),
        },
      ],
      createdAt: r.createdAt,
      displayName: r.displayName,
      identityColor: r.identityColor,
      source: "account" as const,
    })),
  ];
  entries.sort((a, b) => b.createdAt - a.createdAt);
  return entries;
}
