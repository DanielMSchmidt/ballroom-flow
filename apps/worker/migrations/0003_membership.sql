-- US-020 — per-document membership (PLAN §5.1, §2.7).
--
-- D1 is a pure index — this table records WHO may act on a document and at what
-- role. Permission is enforced per document at the sync boundary (US-021) by
-- looking up the connecting user's row here; never by post-hoc CRDT rejection.
--
-- Keyed per (docRef, userId): a routine doc and a figure doc are independently
-- shared (AC-2), so a user can be editor on one and viewer/none on another. This
-- is the #50 sibling invariant — arrangement/membership rows are scoped by the
-- document identity, never a bare entity id. Soft-delete only (deletedAt).

CREATE TABLE IF NOT EXISTS membership (
  id        TEXT PRIMARY KEY,
  docRef    TEXT NOT NULL,
  userId    TEXT NOT NULL,
  role      TEXT NOT NULL,            -- 'viewer' | 'commenter' | 'editor'
  createdAt INTEGER NOT NULL,
  deletedAt INTEGER                   -- soft-delete tombstone (never hard removal)
);

-- At most one ACTIVE membership per (docRef, userId), and the hot lookup the
-- boundary runs: `WHERE docRef = ? AND userId = ? AND deletedAt IS NULL`.
CREATE UNIQUE INDEX IF NOT EXISTS membership_doc_user_idx
  ON membership (docRef, userId)
  WHERE deletedAt IS NULL;

-- The per-document member list (US-023 manage members / invite redemption):
-- `WHERE docRef = ? AND deletedAt IS NULL`.
CREATE INDEX IF NOT EXISTS membership_doc_idx ON membership (docRef, deletedAt);
