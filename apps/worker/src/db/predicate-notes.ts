// attribute-predicate-anchors — the AttributePredicateNoteIndex query + projection
// (docs/concepts/annotations.md § Anchors / § Ownership & visibility;
// docs/system/architecture.md § D1 — the index & projections).
//
// Mirrors db/family-notes.ts name-for-name. A predicate note is OWNED by one user (its
// author = account-doc owner); a shared routine discovers a co-member's dance-/all-scoped
// predicate note through this index, gated on co-membership at the worker route, and the
// client runs matchPredicate over the timelines it can already see. Content lives on the
// row (kind/text), like the family-note index. 'routine'-scoped rows are projected for
// upsert-consistency but never served cross-account (the read filters scope = dance|'all').

/** One predicate-note index row (carries content — see migration 0019). */
export interface PredicateNoteRow {
  noteId: string;
  accountDocRef: string;
  authorId: string;
  attrKind: string;
  attrValue: string;
  attrRole: string | null;
  scope: string;
  kind: string;
  text: string;
  /** The row's last-write time; surfaced so the reading-view margin can order notes. */
  updatedAt: number;
}

/**
 * Predicate-note index rows authored by any of `authorIds` whose scope covers `dance`
 * (the dance itself, or "all"). Excludes tombstoned rows AND 'routine'-scoped rows (which
 * the scope filter excludes structurally — a routine note is self-read only, never served
 * cross-account). Returns [] for an empty author set (a routine with no members → no notes).
 */
export async function predicateNotesForMembers(
  db: D1Database,
  authorIds: string[],
  dance: string,
): Promise<PredicateNoteRow[]> {
  if (authorIds.length === 0) return [];
  const placeholders = authorIds.map(() => "?").join(",");
  const sql =
    `SELECT noteId, accountDocRef, authorId, attrKind, attrValue, attrRole, scope, kind, text, updatedAt FROM attribute_predicate_note_index ` +
    `WHERE deletedAt IS NULL AND (scope = ? OR scope = 'all') ` +
    `AND authorId IN (${placeholders})`;
  const res = await db
    .prepare(sql)
    .bind(dance, ...authorIds)
    .all<PredicateNoteRow>();
  return res.results ?? [];
}

/** One projected predicate-note row: the account doc's attributePredicate annotation,
 *  tombstone carried, projected to `attribute_predicate_note_index`. */
export interface PredicateNoteProjection {
  noteId: string;
  authorId: string;
  attrKind: string;
  attrValue: string;
  attrRole: string | null;
  scope: string;
  kind: string;
  text: string;
  deletedAt: number | null;
}

/**
 * Project the account doc's `attributePredicate` annotations to
 * `attribute_predicate_note_index` (the alarm-written inversion). Stable-key upsert on the
 * reused ULID `noteId`, so this is idempotent and never a wipe-and-rewrite; a tombstoned
 * annotation carries its `deletedAt` through, so a delete projects as a tombstone (never a
 * hard removal). Non-destructive: rows for notes still present in the doc are upserted in
 * place.
 */
export async function projectPredicateNotes(
  db: D1Database,
  notes: PredicateNoteProjection[],
): Promise<void> {
  if (notes.length === 0) return;
  const now = Date.now();
  const stmts = notes.map((n) =>
    db
      .prepare(
        `INSERT INTO attribute_predicate_note_index (noteId, accountDocRef, authorId, attrKind, attrValue, attrRole, scope, kind, text, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(noteId) DO UPDATE SET
           accountDocRef = excluded.accountDocRef, authorId = excluded.authorId,
           attrKind = excluded.attrKind, attrValue = excluded.attrValue,
           attrRole = excluded.attrRole, scope = excluded.scope,
           kind = excluded.kind, text = excluded.text,
           updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt`,
      )
      .bind(
        n.noteId,
        `account:${n.authorId}`,
        n.authorId,
        n.attrKind,
        n.attrValue,
        n.attrRole,
        n.scope,
        n.kind,
        n.text,
        now,
        n.deletedAt,
      ),
  );
  await db.batch(stmts);
}
