-- T6 — JournalEntry index (PLAN §2.6, §2.7, §6). The cross-routine projection of a
-- routine doc's lesson/practice annotations. The routine DO's alarm writes these
-- (mirroring document_registry projection); the journal read UNIONs them with the
-- account-scoped figureType lesson/practice rows in figure_type_note_index.
--
-- D1 stays a PURE INDEX: the routine doc (DO SQLite) is the source of truth. This
-- row is a derived projection — content (kind/text/anchors) is copied here so the
-- cross-routine list never has to fan out to N routine DOs to render. Each anchor
-- in the JSON carries a server-RESOLVED `label` (the placement's figure name) so
-- the client renders "Natural Turn · step 2" with no extra refetch (T6 §3).
--
-- Soft-delete only (deletedAt): a tombstoned/removed annotation flips its row; the
-- next projection won't resurrect it and the read filters it out.

CREATE TABLE IF NOT EXISTS journal_entry (
  entryId    TEXT PRIMARY KEY,    -- the Annotation id (stable across re-projection)
  routineRef TEXT NOT NULL,       -- the routine doc the entry lives in (docRef/doName)
  authorId   TEXT NOT NULL,       -- annotation.authorId (drives the author chip + colour)
  kind       TEXT NOT NULL,       -- 'lesson' | 'practice'
  text       TEXT NOT NULL,
  anchors    TEXT NOT NULL DEFAULT '[]',  -- JSON-encoded Anchor[] (with labels) → link chips
  createdAt  INTEGER NOT NULL,    -- annotation.createdAt (list sort key)
  updatedAt  INTEGER NOT NULL,    -- projection time
  deletedAt  INTEGER              -- soft-delete tombstone
);

-- Hot read: a routine's entries (the projection upsert scopes by routineRef; the
-- journal read gathers entries for the user's accessible routines).
CREATE INDEX IF NOT EXISTS idx_journal_routine ON journal_entry (routineRef, deletedAt);
-- Author sweeps / an author-scoped variant of the read.
CREATE INDEX IF NOT EXISTS idx_journal_author  ON journal_entry (authorId, deletedAt);
