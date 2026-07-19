-- D30 ⟳ (seed-authoritative, self-healing): a tiny key/value meta table so the
-- worker can remember which bundled-catalog content hash the global figure docs
-- were last reconciled to. One PK row read on the API seam; the seeder runs only
-- when the hash differs (new deploy content, fresh environment, or a wiped D1).
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
