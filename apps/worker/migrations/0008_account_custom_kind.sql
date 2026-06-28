-- US-043 — a user's account-wide custom attribute kinds (server-mediated, like
-- family notes). PK (userId, kind) makes upsert + the per-user list cheap and
-- indexed (userId is the leading PK column → no SCAN on the GET).
CREATE TABLE IF NOT EXISTS account_custom_kind (
  userId              TEXT NOT NULL,
  kind                TEXT NOT NULL,            -- slug (e.g. "energy")
  label               TEXT NOT NULL,
  color               TEXT NOT NULL,
  cardinality         TEXT NOT NULL,            -- 'single' | 'multi'
  valueType           TEXT NOT NULL,            -- 'enum' | 'text'
  valuesJson          TEXT,                     -- JSON string[] (nullable)
  freeText            INTEGER,                  -- 0/1 (nullable)
  appliesToDancesJson TEXT,                     -- JSON DanceId[] (nullable)
  updatedAt           INTEGER NOT NULL,
  deletedAt           INTEGER,
  PRIMARY KEY (userId, kind)
);
