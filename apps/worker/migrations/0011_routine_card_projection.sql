-- US-025 (T1) — routine-card data projection (PLAN §2.5, §2.7, §4.1).
--
-- The Choreo list card renders "<dance> · <N bars> · <date>", a "no figures yet"
-- state, and a "⑂ forked from <title>" lineage line (frames 1.1/1.3). To serve
-- those WITHOUT reading any routine's CRDT content on the list path, the DO alarm
-- projects two more thin columns onto `document_registry`:
--
--   • bars        — FIGURE row: the figure's own bar count (`barsForFigure`,
--                   computed by the figure DO from its attributes, max across
--                   roles). ROUTINE row: Σ of its referenced figures' `bars`,
--                   summed by the routine DO by reading the shared index (each DO
--                   still touches only its OWN row — per-document layering).
--   • figureCount — ROUTINE row: the count of NON-deleted placements (`0` →
--                   "no figures yet"). Null for figure/account rows.
--
-- Both nullable + eventually consistent: a fresh routine is listed (eager
-- projection) before its alarm computes these, and a routine's `bars` may lag a
-- figure edit until the routine re-projects (same eventual-consistency contract
-- as the rest of the registry projection, #126). `forkedFromTitle` needs no
-- column — it's resolved on read by a self-join on `forkedFromRef` → that row's
-- title (a PK lookup, EXPLAIN no-SCAN).

ALTER TABLE document_registry ADD COLUMN bars INTEGER;
ALTER TABLE document_registry ADD COLUMN figureCount INTEGER;
