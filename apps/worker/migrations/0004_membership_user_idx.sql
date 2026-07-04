-- US-025 — index membership by user (PLAN §7 "index every D1 query").
--
-- The Choreo list needs the routines SHARED IN to a user: the membership rows
-- WHERE userId = ? AND deletedAt IS NULL. The existing membership indexes lead
-- with docRef (per-doc lookups), so a userId-led query would full-table SCAN.
-- This index serves the shared-in list (US-025) and the user's membership view
-- (US-023). The owned list is already served by document_registry_owner_idx.

CREATE INDEX IF NOT EXISTS membership_user_idx ON membership (userId, deletedAt);
