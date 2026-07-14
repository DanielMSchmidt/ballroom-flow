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

---

## Recover a document to a past point in time (disaster recovery)

Every document is a **SQLite-backed Durable Object**, and Cloudflare retains roughly
**30 days** of each DO's SQLite history **automatically** — there is no backup job of ours
to run or schedule. Recovery is therefore a pure **restore**: rewind one document's storage
to a chosen bookmark using Cloudflare's Durable Object **Point-in-Time Recovery (PITR)**.
This covers **every** document uniformly — routines *and* figure docs — because each is its
own DO with its own retained history; there is nothing figure-specific to back up separately.

**When to use:** a document was corrupted or destructively edited (a bad merge, an errant
bulk delete) and you need it as it was at a known-good earlier time. This is **destructive**
in the forward direction — any changes made *after* the recovery point are discarded — so
confirm the target time with whoever reported the problem first.

**Access:** the recovery endpoint is gated on the **platform-admin** flag (`users.isAdmin`),
**not** on document membership — so a document owner cannot rewind their own (or a shared)
doc through it. You need:
- an **admin** user (set `isAdmin=1` on your own `users` row for the target env if needed:
  `wrangler d1 execute weave-steps-<env> --env <env> --remote --command "UPDATE users SET isAdmin=1 WHERE email='you@example.com';"`),
- that user's **Clerk session JWT** as a bearer token (copy it from the browser devtools of a
  signed-in admin session — the `Authorization: Bearer …` on any `/api/*` request), and
- the target **document ref** (`docRef` — the DO name; find it in the `document_registry`
  table, e.g. `SELECT docRef, title, ownerId, type FROM document_registry WHERE title LIKE '%…%';`).

**Restore:** POST the recovery point as an ISO-8601 time (or `{ "timestamp": <epoch-ms> }`):

```bash
# Rewind ONE document to how it looked at 2026-07-13T09:00:00Z (production)
curl -sS -X POST \
  "https://weave-steps-production.danielmschmidt.workers.dev/api/admin/docs/<docRef>/restore" \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "at": "2026-07-13T09:00:00Z" }'
# → { "ok": true, "docRef": "…", "restoredTo": "2026-07-13T09:00:00.000Z", "bookmark": "…" }
```

The DO restarts to apply the restore, so **any client currently editing that document is
disconnected** and must reload — that socket drop is the expected "restart underway" signal,
not an error. The recovery point must be **in the past** and within the ~30-day retention
window (Cloudflare rejects/clamps times outside it). After it returns, **verify** by reloading
the document (or `GET /api/routines/<docRef>/snapshot` with the admin token).

**Notes**
- Retention is a **rolling ~30 days** — older states are not recoverable this way. There is no
  configuration to extend it; if a longer horizon is ever required it needs a separate
  export-to-R2 job (deliberately not built — see `docs/PRODUCTION-READINESS.md` §4 item 3).
- PITR is a **real-Cloudflare** capability; `miniflare`/local `wrangler dev` does **not**
  implement storage bookmarks, so this path can only be exercised against a **deployed** DO.
  The worker suite unit-tests the endpoint's admin gate + validation only
  (`apps/worker/src/admin-restore.test.ts`); the rewind itself is verified in a deployed env.
