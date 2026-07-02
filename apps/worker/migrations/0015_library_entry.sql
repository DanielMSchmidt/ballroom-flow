-- §2.2/§2.7/§4.2 (⟳v5) — the per-user LIBRARY BOOKMARK projection.
--
-- "Add to my library" is a REFERENCE, never a copy (D28): the account doc's
-- `libraryFigureRefs` set (packages/domain/src/doc-account.ts) is the source of
-- truth; this table is its D1 projection so the library screen (GET
-- /api/figures/mine) can list/search without reading CRDT content. `figureRef` is
-- either an account-figure docRef or a catalog `global:<dance>:<figureType>` ref
-- (globalFigureRef) — several users may hold an entry for the SAME figureRef (a
-- shared doc), which is exactly the point: no divergence, no copy.
--
-- PRIMARY KEY (userId, figureRef) is itself a covering index for "this user's
-- bookmarks" (userId is the leading column) and for the per-(user,figureRef)
-- idempotent add/remove — no separate index needed for either query shape.
--
-- Soft-delete only (§2.1): un-bookmarking tombstones `deletedAt` rather than
-- deleting the row, so a live re-bookmark is a plain revive (no PK-conflict dance).

CREATE TABLE IF NOT EXISTS library_entry (
  userId    TEXT NOT NULL,
  figureRef TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (userId, figureRef)
);
