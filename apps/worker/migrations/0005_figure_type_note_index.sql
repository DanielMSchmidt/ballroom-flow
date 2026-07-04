-- US-041 — FigureTypeNoteIndex (PLAN §2.6, §2.7, §5.1, Q-FIGNOTE-VIS option 2).
--
-- A figure-FAMILY note (US-040) is OWNED by one user (its author = account-doc
-- owner). This is the server-mediated store a shared routine reads to discover
-- "which co-members have a note on this figure family, in this dance scope"
-- WITHOUT browsing anyone's account doc directly (AC-4): the co-membership gate +
-- the read both live in the worker route.
--
-- v1 STORAGE DECISION: the note's CONTENT (kind/text) lives HERE, in the index
-- row — NOT in the account-doc CRDT. Family notes are single-author,
-- non-collaborative reference data, so the index row is the source of truth and
-- the read returns it directly (no cross-account doc fetch). The account-doc CRDT
-- model (doc-account.ts) is built + tested as the intended home if family notes
-- ever need offline/concurrent edit; until then the design-doc "content lives in
-- the account doc" is aspirational, not what this migration implements.
--
-- Soft-delete only (deletedAt): a tombstoned family note flips its row, the next
-- projection won't resurrect it, and a concurrent read filters it out.

CREATE TABLE IF NOT EXISTS figure_type_note_index (
  noteId        TEXT PRIMARY KEY,        -- the Annotation id
  accountDocRef TEXT NOT NULL,           -- the author's account doc (account:<userId>)
  authorId      TEXT NOT NULL,           -- the note's author (= account doc owner)
  figureType    TEXT NOT NULL,           -- the figure family the note anchors to
  danceScope    TEXT NOT NULL,           -- a DanceId, or 'all' (every dance)
  -- Content lives here in v1 (see the storage-decision note above), not the CRDT.
  kind          TEXT NOT NULL DEFAULT 'note',  -- note | lesson | practice
  text          TEXT NOT NULL DEFAULT '',
  updatedAt     INTEGER NOT NULL,
  deletedAt     INTEGER                  -- soft-delete tombstone
);

-- The hot discovery lookup: notes for a figure family in a dance scope —
-- `WHERE figureType = ? AND (danceScope = ? OR danceScope = 'all')`.
CREATE INDEX IF NOT EXISTS idx_ftni_family ON figure_type_note_index (figureType, danceScope);

-- Resolve all of one author's family notes (re-projection / by-member sweeps).
CREATE INDEX IF NOT EXISTS idx_ftni_author ON figure_type_note_index (authorId, deletedAt);
