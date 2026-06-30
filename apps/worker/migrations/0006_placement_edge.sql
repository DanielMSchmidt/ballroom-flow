-- Cascade access (decided 2026-06-27): inviting a user to a ROUTINE grants them
-- read access to the FIGURE docs that routine references (and to its annotations/
-- comments, which already live in the routine doc). Figure docs are otherwise
-- shared independently (US-020 AC-2), so without this a co-member couldn't see a
-- shared routine's figures.
--
-- This thin edge index records "routine R references figure F" — written when a
-- figure is added to a routine. Figure-doc authorization derives a role for any
-- member of a routine that references the figure (read-time cascade, so it's
-- order-independent: works whether the figure or the member was added first): a
-- routine EDITOR may EDIT the referenced figure; a commenter/viewer gets a
-- read-only VIEWER. The cascade never grants `owner` (no figure delete), and is
-- inert for routine docs (a routineRef is never a figureRef here) — so it only
-- ever ADDS figure access, never escalates a routine role or affects a routine's
-- own boundary. See cascadeFigureRole in db/placement-edge.ts.

CREATE TABLE IF NOT EXISTS placement_edge (
  routineRef TEXT NOT NULL,
  figureRef  TEXT NOT NULL,
  PRIMARY KEY (routineRef, figureRef)
);

-- The cascade lookup: routines that reference a figure — `WHERE figureRef = ?`.
CREATE INDEX IF NOT EXISTS idx_placement_edge_figure ON placement_edge (figureRef);
