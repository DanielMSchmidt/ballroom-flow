-- US-041 — FigureTypeNoteIndex (PLAN §2.6, §2.7, §5.1, Q-FIGNOTE-VIS option 2).
--
-- A figure-FAMILY note (US-040) is OWNED in the author's account doc — its
-- CONTENT lives there, never in D1. This is the thin, content-free INDEX the
-- account-doc DO alarm projects (one row per family note): just enough for a
-- shared routine to discover "which co-members have a note on this figure
-- family, in this dance scope" without browsing anyone's account doc wholesale
-- (AC-4). The co-membership gate + the scoped read live in the worker route.
--
-- Soft-delete only (deletedAt): a tombstoned family note flips its row, the next
-- projection won't resurrect it, and a concurrent read filters it out.

CREATE TABLE IF NOT EXISTS figure_type_note_index (
  noteId        TEXT PRIMARY KEY,        -- the Annotation id in the account doc
  accountDocRef TEXT NOT NULL,           -- the author's account doc (account:<userId>)
  authorId      TEXT NOT NULL,           -- the note's author (= account doc owner)
  figureType    TEXT NOT NULL,           -- the figure family the note anchors to
  danceScope    TEXT NOT NULL,           -- a DanceId, or 'all' (every dance)
  updatedAt     INTEGER NOT NULL,
  deletedAt     INTEGER                  -- soft-delete tombstone
);

-- The hot discovery lookup: notes for a figure family in a dance scope —
-- `WHERE figureType = ? AND (danceScope = ? OR danceScope = 'all')`.
CREATE INDEX IF NOT EXISTS idx_ftni_family ON figure_type_note_index (figureType, danceScope);

-- Resolve all of one author's family notes (re-projection / by-member sweeps).
CREATE INDEX IF NOT EXISTS idx_ftni_author ON figure_type_note_index (authorId, deletedAt);
