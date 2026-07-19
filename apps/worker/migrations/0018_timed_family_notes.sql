-- WEP-0004 (docs/concepts/annotations.md § Anchors) — TIMED figure-family notes ("count 3 of every Whisk in my Waltz
-- choreos"): the figureType anchor gained optional `count`/`role`, and in the
-- v1 storage model a family note's CONTENT lives on its FigureTypeNoteIndex row
-- (migration 0005), so the row carries the two new fields too.
--
-- Additive + nullable: NULL = the untimed v1 whole-figure note (the entire
-- existing corpus), so no backfill and no read-path change is needed. These are
-- note CONTENT, not query keys — familyNotesForMembers still filters by
-- (authorId, danceScope) through the existing indexes; no new index.
--
-- `count` is a timing position on the 1/8-note grid (REAL — sub-beats like 2.5
-- exist); `role` narrows the note to one side ('leader'/'follower'; NULL = both).
-- The REST boundary (zFamilyNoteBody) rejects count/role with danceScope 'all' —
-- counts don't align across dances.

ALTER TABLE figure_type_note_index ADD COLUMN count REAL;
ALTER TABLE figure_type_note_index ADD COLUMN role TEXT;
