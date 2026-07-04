-- Follow-up to US-043 — persist the data-driven RegistryKind fields added in
-- #111 (PLAN §3): a one-line `description`, per-value definitions, role-awareness
-- (L/F), and the required-slot marker. The creation editor (AddKindSheet) now
-- captures these, so the account_custom_kind table must round-trip them — else a
-- user-authored kind loses its prose/flags on reload.
--
-- All nullable: a kind created before this migration (or one the author left
-- blank) simply has NULL → the info-sheet falls back to the raw value list and
-- Profile hides the L/F / required affordances (same graceful degradation as a
-- builtin that omits them).
ALTER TABLE account_custom_kind ADD COLUMN description TEXT;
ALTER TABLE account_custom_kind ADD COLUMN valueDefsJson TEXT; -- JSON Record<string,string> (nullable)
ALTER TABLE account_custom_kind ADD COLUMN roleAware INTEGER;  -- 0/1 (nullable)
ALTER TABLE account_custom_kind ADD COLUMN required INTEGER;   -- 0/1 (nullable)
