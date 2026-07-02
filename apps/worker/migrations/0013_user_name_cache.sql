-- User display-name cache (request: "get something better from Clerk" for names).
--
-- A member who is logged in but hasn't completed onboarding has NO `users` row,
-- so the Share/thread member list could only fall back to the raw Clerk user id
-- (e.g. "user_3Fe55l…"). We cache the human name derived from each user's Clerk
-- session-token claims (displayNameFromClaims) the moment they load the app (GET
-- /api/me), keyed by the Clerk `sub`. `listMembers` then LEFT JOINs this so a
-- co-member's name resolves even before they onboard. Distinct from `users` on
-- purpose: writing here must NOT look like onboarding (starter-routine seed,
-- `onboarded` state) — it's a name cache, nothing more.
CREATE TABLE IF NOT EXISTS user_name_cache (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
