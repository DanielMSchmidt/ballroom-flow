-- US-033/US-034 — figure→routine usage edges + a global-library browse index
-- (PLAN §2.7, §4.2, D-3). D1 stays a PURE INDEX: `figure_usage` is a projected
-- edge (which routines reference which figure docs), NOT CRDT content. The edges
-- are projected by each ROUTINE DO's alarm from its OWN placements (scoped to
-- that routineRef — the per-document layering invariant), and power "used in N
-- routines" (US-033 AC-2) without a CRDT scan. Soft-delete only (a placement
-- removal tombstones its edge; never a hard removal).

CREATE TABLE IF NOT EXISTS figure_usage (
  routineRef TEXT NOT NULL,           -- the referencing routine doc
  figureRef  TEXT NOT NULL,           -- the referenced figure doc
  deletedAt  INTEGER,                 -- tombstone (the placement was removed)
  PRIMARY KEY (routineRef, figureRef) -- one edge per (routine, figure); upsert
);

-- "used in N routines": COUNT(DISTINCT routineRef) WHERE figureRef = ? AND
-- deletedAt IS NULL — served by a (figureRef, deletedAt) covering search.
CREATE INDEX IF NOT EXISTS figure_usage_figure_idx ON figure_usage (figureRef, deletedAt);

-- Global library browse (US-032): `WHERE type = 'global-figure' AND deletedAt IS
-- NULL [AND dance = ?]`. The existing owner_idx leads with ownerId, so the
-- by-type browse needs its own index leading with (type, dance).
CREATE INDEX IF NOT EXISTS document_registry_type_idx
  ON document_registry (type, dance, deletedAt);
