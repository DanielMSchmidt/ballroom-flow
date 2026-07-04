-- US-046 — prefix search index. SQLite uses an index for a prefix LIKE ('q%')
-- only when the column collates the same way the LIKE compares; LIKE is
-- case-insensitive by default, so the index must be COLLATE NOCASE.
CREATE INDEX IF NOT EXISTS document_registry_title_idx
  ON document_registry (title COLLATE NOCASE);
