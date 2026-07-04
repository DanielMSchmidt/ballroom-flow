-- T5 (save-to-library) — make the "↟ Save to my library" promotion idempotent at
-- the DATABASE level, not just app-level. `POST /api/figures/save-to-library`
-- checks `findSavedLibraryFigure` then `createFigureRows`, but with no DB
-- uniqueness two CONCURRENT saves from the same user both pass the SELECT and
-- INSERT, surfacing a duplicate copy in "Mine" (TOCTOU). This partial unique index
-- is the real guard: a user may hold at most ONE live account-figure copied from a
-- given global figure (its provenance lives in `forkedFromRef =
-- globalFigureRef(dance, figureType)`). The route catches the conflict and returns
-- the existing copy (200, alreadySaved) — never a 500.
--
-- Scope notes: partial on `type='account-figure'` (routines/global figures are
-- unaffected) and `deletedAt IS NULL` (a deleted copy can be re-saved). A custom
-- figure has `forkedFromRef IS NULL`; SQLite treats NULLs as DISTINCT in a unique
-- index, so a user can still own many from-scratch customs.

CREATE UNIQUE INDEX IF NOT EXISTS account_figure_base_idx
  ON document_registry (ownerId, forkedFromRef)
  WHERE type = 'account-figure' AND deletedAt IS NULL;
