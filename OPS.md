# OPS — operational runbook

Manual operator actions against the live app (staging/production). For **accounts &
secrets** see [`PROVISIONING.md`](PROVISIONING.md); for **running/deploying** see
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) and the `ballroom-flow-run-and-operate` skill.

These actions write to **remote D1** via `wrangler`, so they need your Cloudflare auth
in the shell (`wrangler login`, or `CLOUDFLARE_API_TOKEN` set). Everything here defaults
to **staging**; production always requires an explicit `--env production`.

---

## Grant a user a higher choreography (routine) limit — no payment

Free users can own **3 routines** (`FREE_ROUTINE_CAP`, `apps/worker/src/db/routines.ts`).
The quota seam (`routineCapFor`, `apps/worker/src/db/admin.ts`) reads a nullable per-user
override, `users.routineCapOverride`, **before** the plan default — so raising one person's
limit is a single field write. This is the intended "granted via ops tooling until the admin
UI lands" path (migration `0014_admin.sql`); no Clerk metadata or billing involved.

**Prerequisite:** the user must have **signed in at least once** — that first sign-in creates
their row in the D1 `users` table. The script refuses to grant against a non-existent row.

Use the `grant-cap` script (`apps/worker/scripts/grant-cap.mjs`). Note the `--` separator so
pnpm forwards the flags to the script:

```bash
# Raise a friend's owned-routine cap to 15 (defaults to STAGING)
pnpm --filter worker grant-cap -- --email friend@example.com --cap 15

# Same, on production
pnpm --filter worker grant-cap -- --email friend@example.com --cap 15 --env production

# Target by Clerk user id (JWT `sub`) instead of email
pnpm --filter worker grant-cap -- --id user_2abc... --cap 15 --env production

# Inspect only — print the current row, change nothing
pnpm --filter worker grant-cap -- --email friend@example.com --show

# Reset back to the plan default (override → NULL)
pnpm --filter worker grant-cap -- --email friend@example.com --clear
```

The script prints the row **before and after** the change so you can confirm it landed.

**Flags:** `--email <e>` / `--id <sub>` (target, pick one) · `--cap <n>` (integer ≥ 0) ·
`--clear` (override → NULL) · `--show` (read-only) · `--env staging|production` (default
`staging`).

**Notes**
- `--cap` keeps the user on the **`free` plan** but lifts their owned-routine limit. The cap
  counts **owned** routines only — routines shared *in* to them don't count.
- For a truly **unlimited** grant, set the plan instead of an override:
  `UPDATE users SET plan='pro' WHERE email='…';` (`pro` resolves to an unbounded cap). Do this
  via `wrangler d1 execute weave-steps-production --env production --remote --command "…"`.
- To find who exists / their ids:
  `wrangler d1 execute weave-steps-<env> --env <env> --remote --command "SELECT id, email, plan, routineCapOverride FROM users;"`
