-- D31 (⟳v5) — the admin seam (docs/system/architecture.md § D1 — the index &
-- projections; docs/concepts/figures.md § Variants; docs/concepts/collaboration.md
-- § Who uses this; D31).
--
-- Two nullable/defaulted columns on `users` so the admin concept lands without a
-- new table:
--   • isAdmin — gates in-app GLOBAL-figure editing (an admin resolves to `editor`
--     on a global-figure doc; a non-admin is a `viewer` and their edit spawns a
--     variant client-side) and the §11 admin surfaces (elevation queue, seeder).
--   • routineCapOverride — a per-user owned-routine cap an admin can RAISE above
--     the plan default; the quota seam (routineCapFor) reads it BEFORE the plan
--     cap. NULL = no override → the plan default applies. Granted via ops tooling
--     until the admin UI lands.
--
-- Both are additive: existing users default to isAdmin=0 / routineCapOverride=NULL,
-- so nobody is elevated and every plan keeps its default cap.
ALTER TABLE users ADD COLUMN isAdmin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN routineCapOverride INTEGER;
