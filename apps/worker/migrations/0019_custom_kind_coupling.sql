-- Author-defined role couplings (docs/concepts/notation.md § Kinds / § Role
-- lenses): a custom role-aware ENUM kind may declare how a Both-lens write
-- derives the follower from the leader — a `bothWrite` mode ("mirror") plus a
-- `coupling` map (leader value → follower value). Built-ins carry these in the
-- code registry; a custom kind now persists them beside its value list, so the
-- follower derivation survives a reload.
--
-- Both nullable: a kind created before this migration (or one that declares no
-- coupling) has NULL → deriveFollowerValue falls back to "copy" (one shared
-- value), exactly as before.
ALTER TABLE account_custom_kind ADD COLUMN bothWrite TEXT;    -- "copy" | "mirror" | "leaderOnly" (nullable)
ALTER TABLE account_custom_kind ADD COLUMN couplingJson TEXT; -- JSON Record<leaderValue,followerValue> (nullable)
