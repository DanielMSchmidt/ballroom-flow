-- attribute-predicate-anchors — AttributePredicateNoteIndex
-- (docs/concepts/annotations.md § Anchors / § Ownership & visibility;
-- docs/system/architecture.md § D1 — the index & projections).
--
-- The fourth annotation anchor (attributePredicate) surfaces one note on every
-- step whose notation matches an attribute condition ("soften every left sway").
-- Like a figure-family note it is OWNED by one user; a shared routine discovers a
-- co-member's dance-/all-scoped predicate note through THIS index WITHOUT reading
-- anyone's account doc — the co-membership gate + the read live in the worker
-- route, and the client runs matchPredicate over the timelines it can already see.
--
-- Mirrors figure_type_note_index (migration 0005) exactly: content-carrying,
-- alarm-projected from the account DO (the single writer), non-destructive,
-- idempotent, tombstone-aware. Soft-delete only (deletedAt flips the row; the
-- next projection won't resurrect it; a concurrent read filters it out).

CREATE TABLE IF NOT EXISTS attribute_predicate_note_index (
  noteId        TEXT PRIMARY KEY,        -- the Annotation id (reused ULID)
  accountDocRef TEXT NOT NULL,           -- the author's account doc (account:<userId>)
  authorId      TEXT NOT NULL,           -- the note's author (= account doc owner)
  attrKind      TEXT NOT NULL,           -- merged-registry kind (builtin or custom)
  attrValue     TEXT NOT NULL,           -- registry value, or 'none' (absence sentinel)
  attrRole      TEXT,                    -- 'leader' | 'follower' | NULL = both
  scope         TEXT NOT NULL,           -- DanceId | 'all' | 'routine' ('routine' rows are
                                         -- projected for upsert-consistency but NEVER served
                                         -- cross-account: the read filters scope = dance|'all')
  kind          TEXT NOT NULL DEFAULT 'note',  -- note | lesson | practice
  text          TEXT NOT NULL DEFAULT '',
  updatedAt     INTEGER NOT NULL,
  deletedAt     INTEGER                  -- soft-delete tombstone
);

-- The discovery lookup: predicate notes for a kind/value in a scope.
CREATE INDEX IF NOT EXISTS idx_apni_predicate ON attribute_predicate_note_index (attrKind, attrValue, scope);

-- Resolve all of one author's predicate notes (the by-member read + re-projection sweeps).
CREATE INDEX IF NOT EXISTS idx_apni_author ON attribute_predicate_note_index (authorId, deletedAt);
