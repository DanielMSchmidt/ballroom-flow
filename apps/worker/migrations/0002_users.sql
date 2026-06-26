-- US-019 — users table (PLAN §2.7, §4.0, §4.8, D9).
--
-- D1 is a PURE INDEX over the document graph — this table holds the account
-- identity captured at onboarding (Clerk `sub` → display name + identity color +
-- plan). It is NOT CRDT content; the user's editable docs live in their DOs.
--
-- `id` is the Clerk user id (`sub`) verified networklessly from the session JWT
-- (auth/index.ts). One row per account; onboarding upserts displayName +
-- identityColor, plan defaults to 'free' until billing (US-053/quota).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,        -- Clerk sub (verified from the JWT)
  displayName   TEXT NOT NULL,
  identityColor TEXT NOT NULL,           -- the user's annotation/identity color
  plan          TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'pro'
  createdAt     INTEGER                  -- unix millis; set on first onboarding
);
