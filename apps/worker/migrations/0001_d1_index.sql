-- US-016 — D1 index/registry schema (PLAN §6.2, §2.7, D24).
--
-- D1 is a PURE INDEX over the document graph — NO CRDT content lives here
-- (canonical doc state is each DO's SQLite). The DO alarm projects a thin
-- registry row off the request path so list/search never read CRDT content.
--
-- Keyed by the document's identity (docRef) and its DO name (doName) — per the
-- #50 invariant, registry rows are scoped by docId/doName so two docs that share
-- nested entity ids (origin + fork) never collide in this shared table.
--
-- Scope: this migration lands the two tables US-016's alarm writes —
-- `document_registry` (the index projection) and `invite` (the expiry sweep).
-- `users` / `membership` / figureType-note index are their own stories' tables.

-- The thin per-document index row. One row per document (routine/figure/account),
-- projected from the DO on its alarm. `doName` is the DO's name (idFromName key);
-- `docRef` is the logical document id (ULID).
CREATE TABLE IF NOT EXISTS document_registry (
  docRef        TEXT PRIMARY KEY,
  type          TEXT NOT NULL,           -- 'routine' | 'global-figure' | 'account-figure' | 'account'
  ownerId       TEXT NOT NULL,
  doName        TEXT NOT NULL UNIQUE,    -- the DO's idFromName key (one DO per document)
  figureType    TEXT,
  dance         TEXT,
  title         TEXT,
  forkedFromRef TEXT,
  updatedAt     INTEGER NOT NULL,
  deletedAt     INTEGER                  -- soft-delete tombstone (never hard removal)
);

-- Owner's routine list, newest first (US-025 list, quota count): the hot path is
-- `WHERE ownerId = ? AND type = ? AND deletedAt IS NULL ORDER BY updatedAt DESC`.
CREATE INDEX IF NOT EXISTS document_registry_owner_idx
  ON document_registry (ownerId, type, deletedAt, updatedAt);

-- Lookup/projection by the DO name (the alarm upsert + the US-016 projection read).
CREATE INDEX IF NOT EXISTS document_registry_doName_idx ON document_registry (doName);

-- Per-document membership invites. The alarm expires due ones off the request
-- path; invite rows themselves are exercised in M3 (US-023). `expiresAt` is unix
-- millis; `redeemedAt` NULL = still open.
CREATE TABLE IF NOT EXISTS invite (
  id         TEXT PRIMARY KEY,
  docRef     TEXT NOT NULL,
  role       TEXT NOT NULL,              -- 'viewer' | 'commenter' | 'editor'
  expiresAt  INTEGER NOT NULL,
  redeemedAt INTEGER
);

-- The alarm's expiry sweep: `WHERE redeemedAt IS NULL AND expiresAt < ?`.
CREATE INDEX IF NOT EXISTS invite_expiry_idx ON invite (redeemedAt, expiresAt);
