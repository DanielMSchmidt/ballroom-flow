---
name: ballroom-flow-run-and-operate
description: Load when running Ballroom Flow locally (pnpm dev), deploying to staging/production, managing wrangler environments, secrets, or D1 migrations, running the screenshot bot pipeline, or performing ops actions (secrets rotation, admin/quota grants, template re-seeding). For the seed-data generators this covers only how to run them - their semantics and the charting workflow live in ballroom-flow-figure-data-pipeline.
---

# Ballroom Flow — run and operate

Runbook for the app's runtime and operations surface: local dev, the four wrangler
environments, the deploy pipeline, D1 migrations, generated artifacts, the screenshot
bot, and ops-only actions.

**When NOT to use this:**
- Installing the toolchain, build/typecheck/lint/test commands, coverage, CI-gate parity,
  or sandbox workarounds → **ballroom-flow-build-and-env**.
- Writing or running tests (layers, harness conventions, E2E authoring) →
  **ballroom-flow-validation-and-qa**.
- What the seed JSON files mean and how figure data was researched →
  **ballroom-flow-figure-data-pipeline** (this skill only covers *running* the generators).
- Branching, PR flow, TDD doctrine → **ballroom-flow-change-control**.
- Something is broken and you're diagnosing → **ballroom-flow-debugging-playbook**.

---

## 1. Local dev: what `pnpm dev` actually runs

```bash
pnpm dev            # from repo root
```

Root `package.json` runs both halves with `concurrently` (names `web`/`worker`):

| Half | Command | Port | What it is |
|---|---|---|---|
| web | `pnpm --filter web dev` (Vite) | **:5173** | React PWA dev server; `apps/web/vite.config.ts` proxies `/api` → `http://localhost:8787` |
| worker | `pnpm --filter worker dev` (`wrangler dev`) | **:8787** | Hono API + **local D1 (Miniflare SQLite)** + Durable Objects, all in local `workerd`. No Cloudflare account touched. |

Run one side alone: `pnpm --filter web dev` or `pnpm --filter worker dev`.

**Local D1 schema:** `wrangler dev` does not auto-apply migrations. If API calls fail on
missing tables, apply them to the local dev database first:

```bash
cd apps/worker && pnpm exec wrangler d1 migrations apply DB --local
```

(This is the same command pattern `apps/web/e2e/serve.sh` uses with `--env e2e`.)

### With vs without Clerk keys

Everything builds/tests with **zero secrets**. Keys only gate real sign-in:

| State | Behaviour |
|---|---|
| No `VITE_CLERK_PUBLISHABLE_KEY` | SPA renders a graceful first-run notice — "Set `VITE_CLERK_PUBLISHABLE_KEY` in `apps/web/.env.local` to enable sign-in. See PROVISIONING.md." (`apps/web/src/main.tsx:20-32`). API still boots; authed routes 401. |
| `apps/web/.env.local` → `VITE_CLERK_PUBLISHABLE_KEY=pk_test_…` | Real Clerk sign-in UI in the dev SPA (key is baked in at build time). |
| `apps/worker/.dev.vars` → `CLERK_SECRET_KEY=sk_…` (+ optional `CLERK_JWT_KEY` PEM) | Worker verifies real sessions; with the PEM, verification is **networkless** (`@clerk/backend` `verifyToken`, `apps/worker/src/auth/index.ts`). `wrangler dev` loads `.dev.vars` automatically. |

Both files are git-ignored; there is **no `.env.example` / `.dev.vars.example`** — write
them by hand from `PROVISIONING.md`. E2E runs need neither (see §2, `e2e` env).

---

## 2. The four wrangler environments (`apps/worker/wrangler.toml`)

Named environments do **not inherit bindings** — DB and `DOC_DO` are redeclared per env
(the toml says so explicitly). All envs share `migrations_dir = "migrations"`.

| Env | Worker name | Assets dir | D1 | Special vars | Purpose |
|---|---|---|---|---|---|
| *(default)* | `ballroom-flow` | `../web/dist` | `ballroom-flow-dev`, id `00000000-…` (Miniflare local file; id ignored) | — | `wrangler dev` + the vitest-pool-workers tests |
| `e2e` | `ballroom-flow-e2e` | **`../web/dist-e2e`** | `ballroom-flow-e2e`, id zeros (local only) | `E2E_TEST_ROUTES = "1"` (mounts `/api/test/*`); a **committed throwaway test `CLERK_JWT_KEY` PEM** mirroring `src/test-support/test-keys.ts` | Playwright's one-origin server via `apps/web/e2e/serve.sh`. **Local `wrangler dev --env e2e` only — NEVER deployed.** |
| `staging` | `ballroom-flow-staging` | `../web/dist` | `ballroom-flow-staging`, id `ad9ea4d2-3687-411d-a664-a938dc91b541` | — | Deployed from `development`; live at `ballroom-flow-staging.danielmschmidt.workers.dev` |
| `production` | `ballroom-flow-production` | `../web/dist` | `ballroom-flow-production`, id `55ba153e-a24e-4cf6-8579-213b236abae5` | — | Deployed from `main` |

The committed e2e PEM is a *public* key for a throwaway test keypair — it lets locally
minted test JWTs verify networklessly. It grants nothing outside the local e2e env.

### THE RULE: `dist-e2e` is an auth-bypass bundle and must never deploy

The E2E SPA build (`VITE_E2E=1`) bakes in an **auth bypass** (no Clerk; an injected test
session). It is built into `apps/web/dist-e2e` (git-ignored), and only `[env.e2e.assets]`
points there.

**Why (incident `e71d06d` — full story: ballroom-flow-failure-archaeology):** when the E2E
build shared `apps/web/dist` with deploys, every "successful" staging deploy shipped the
auth-bypass bundle. The fix — and the standing rule — is **output isolation by path, never
step ordering**: E2E builds to `dist-e2e` (gitignored) and only `[env.e2e]` serves it.

Corollaries when touching this area:
- Never point `[assets]` of a deployable env at `dist-e2e`, and never make any build
  step write E2E output into `dist`.
- Verify after any build-pipeline change: a plain `pnpm -r build` must produce a `dist`
  containing Clerk and **no** `e2e-account` bypass marker, and `dist` must stay clean
  after `serve.sh` runs.

---

## 3. Deploy pipeline (`.github/workflows/deploy.yml`)

Trigger: **push** to `development` → **staging**; push to `main` → **production**
(GitHub Environment resolved from the ref). Concurrency: one deploy per branch,
`cancel-in-progress: false`.

Steps, in order (the full gate re-runs before anything ships — deploy.yml runs on
`push`, which the PR-only `ci.yml` never sees):

1. `pnpm install --frozen-lockfile`
2. `pnpm lint` → `pnpm -r typecheck` → `pnpm -r build` (with `VITE_CLERK_PUBLISHABLE_KEY`
   from the GitHub Environment *variable* — public, baked into the SPA) → `pnpm -r test`
3. `playwright install --with-deps chromium`, then the **@smoke** E2E gate:
   `playwright test --project=chromium-desktop --grep @smoke` — a merge cannot deploy on
   a red journey
4. `wrangler d1 migrations apply DB --env <staging|production> --remote` — **remote
   migrations apply before the code that depends on them**
5. `wrangler deploy --env <staging|production>` (Worker + SPA assets in one deploy)

**Graceful skip:** if the environment's `CLOUDFLARE_API_TOKEN` secret is unset, steps 4-5
are skipped with a `::notice` pointing at PROVISIONING.md — the gate still runs, nothing
ships, nothing fails.

Secrets/vars live in GitHub **Environments** `staging` and `production`:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (secrets), `VITE_CLERK_PUBLISHABLE_KEY`
(variable). Worker-side runtime secrets are **Wrangler secrets**, set once per env:

```bash
cd apps/worker
pnpm exec wrangler secret put CLERK_SECRET_KEY --env staging      # done (PROVISIONING.md)
pnpm exec wrangler secret put CLERK_SECRET_KEY --env production   # ⬜ STILL TODO as of 2026-07-02
```

**Open ops item (as of 2026-07-02):** production `CLERK_SECRET_KEY` is unset, pending a
Clerk production instance (`sk_live`) — PROVISIONING.md status table. Until it's set,
deployed production auth fails closed. Staging is live and sign-in works.

---

## 4. D1 migrations (`apps/worker/migrations/`)

**15 migrations exist as of 2026-07-02, HEAD `c9622c9`** (`0001_d1_index.sql` …
`0014_admin.sql` — the D31 `isAdmin`/`routineCapOverride` columns — and
`0015_library_entry.sql` — the per-user library-bookmark projection).
Ignore DEVELOPMENT.md's "migrations dir is empty until M2" — stale.

Where they get applied (three places, same files):

| Context | Mechanism |
|---|---|
| Worker/DO tests | Read at config time (`apps/worker/vitest.config.ts`) into the `env.TEST_MIGRATIONS` binding; each suite calls the `applyMigrations()` fixture in `beforeAll`, which runs the migration SQL directly against the shared D1 — deliberately not via `applyD1Migrations` (see ballroom-flow-validation-and-qa §3.2) |
| Local dev / E2E | `wrangler d1 migrations apply DB --local [--env e2e --persist-to …]` (serve.sh does the e2e one on every run against a fresh DB) |
| Staging/production | deploy.yml step: `wrangler d1 migrations apply DB --env <target> --remote` |

### How to add a migration (the repo's actual convention)

The shipped migrations are **hand-authored SQL** with heavy prose comments explaining the
invariant each table serves (open `0001_d1_index.sql` for the house style) — they are
*not* drizzle-kit-generated output (no `meta/` journal exists). `drizzle-kit` ^0.31.10 is
a devDependency with `apps/worker/drizzle.config.ts` (`dialect: "sqlite"`,
`schema: "./src/db/schema.ts"`, `out: "./migrations"`) available as scaffolding, but
current practice is:

1. Write `apps/worker/migrations/00NN_<slug>.sql` by hand — next zero-padded number,
   `CREATE TABLE IF NOT EXISTS` / guarded DDL, a comment block stating the story/PLAN
   section and why. **Index every queried column** — D1 bills rows *scanned*, and the
   `expectIndexedQuery` EXPLAIN gate (`apps/worker/src/test-support/explain.ts`) fails
   tests on unindexed scans.
2. Update the matching Drizzle table in `apps/worker/src/db/schema.ts` **in the same
   change** (the schema file is the TS type source; the SQL is what runs — keep them in
   lockstep by hand).
3. Tests pick the new file up automatically via `TEST_MIGRATIONS`; run
   `pnpm --filter worker test`.
4. Remote apply happens on the next deploy (step 4 above). Migrations are
   forward-only — no down migrations exist; D1 content is a rebuildable **pure index**
   (canonical state lives in each DO's SQLite), so the recovery story is re-projection,
   not rollback.
5. Remember the doctrine: D1 is a pure index/registry — **no CRDT content** in any
   migration (see ballroom-flow-architecture-contract).

---

## 5. Generated artifacts: regenerate, never hand-edit

Two checked-in TypeScript files in `packages/domain/src/` are generator output. Both
generators are **offline, deterministic, and byte-stable** (they run
`biome format --write` on their output), so a re-run on an unchanged seed produces an
empty diff.

| Generator (run from repo root) | Reads | Writes | Expected output line |
|---|---|---|---|
| `node scripts/gen-library.mjs` | `docs/seed/istd-standard-figures.json` (identity, system of record) + `docs/seed/wdsf-standard-figures.json` (timing enrichment) | `packages/domain/src/library-data.ts` | `wrote 204 figures to packages/domain/src/library-data.ts` |
| `node scripts/gen-figure-charts.mjs` | `docs/seed/figure-charts.json` (researched per-step charts; drops no-op sway/turn "none") | `packages/domain/src/figure-charts.generated.ts` (`GENERATED_FIGURE_STEPS` + `GENERATED_FIGURE_ALIGNMENTS`) | `wrote 147 charts to packages/domain/src/figure-charts.generated.ts` |

Counts are as of 2026-07-02. Workflow:

```bash
# 1. Edit the seed JSON (never the .ts output) — semantics in ballroom-flow-figure-data-pipeline
node scripts/gen-library.mjs
node scripts/gen-figure-charts.mjs
git diff --stat        # 2. Only the intended generated file(s) changed
pnpm --filter @ballroom/domain test   # 3. library-data / figure-steps tests still pass
```

If `git diff` shows changes after running a generator on an *untouched* seed, something
drifted (someone hand-edited the output, or the generator changed) — treat as a bug.

---

## 6. Screenshot pipeline & nightly matrix

### Screenshot bot (`.github/workflows/screenshots.yml`)

Regenerates the committed landing-page marketing screenshots on PRs into `development`,
auto-commits them to the PR branch, and upserts a before/after comment.

- **Trigger:** `pull_request` path-filtered to `apps/web/**`, `apps/worker/**`,
  `packages/**`, the workflow itself, and `scripts/screenshot-diff.mjs`; plus
  `workflow_dispatch`. Excluded from the smoke critical path.
- **Journey:** `pnpm --filter web screenshots` =
  `playwright test --grep @screenshots --project=chromium-desktop` — a deterministic
  E2E journey (`apps/web/e2e/screenshots.spec.ts`, tagged `@screenshots`, deliberately
  NOT `@smoke`) that drives the real app via the e2e harness and captures
  `apps/web/src/marketing/screenshots/`.
- **Loop guard:** skips when HEAD's author is `screenshot-bot` or the subject contains
  `[skip ci]` (the bot commits as `chore(screenshots): regenerate landing imagery [skip ci]`).
- **Diff comment:** `node scripts/screenshot-diff.mjs <baseSha> <owner> <repo> <headSha>`
  pixel-diffs (pixelmatch, threshold 0.1) against the PR base and writes
  `screenshot-comment.md`, upserted under the `<!-- screenshot-bot -->` marker.

**`scripts/screenshot-diff.mjs` is CI-only** — its `main()` needs PR context (base SHA,
repo coordinates) and git history. Don't run it locally expecting useful output; the pure
functions are exported for tests (note: `scripts/screenshot-diff.test.mjs` is a vitest
file wired into **no** runner as of 2026-07-02 — running it with `node --test` fails on
a vitest import; known orphan).

### Nightly (`.github/workflows/nightly.yml`)

Cron `0 5 * * *` UTC + `workflow_dispatch`. Runs the **full 3-project Playwright matrix**
(chromium-desktop, mobile-chrome/Pixel 7, mobile-safari/iPhone 14 — installs chromium +
webkit) against the real e2e harness, uploads the Playwright report artifact (7 days),
plus a Lighthouse **stub** job (real budgets are M9, PLAN §7). This is the "full" gate;
PRs only run `@smoke` chromium.

---

## 7. Ops actions

Things done by an operator (Cloudflare/Clerk dashboards, `wrangler` CLI, direct D1
statements) rather than through app UI.

### Admin seams — SHIPPED (PR #137, migration 0014; PLAN §9 step 6 ✅)

v1 admin is two columns on `users` (D31, `0014_admin.sql`, in `db/schema.ts`):

- **`isAdmin`** (INTEGER, default 0) — an admin resolves to **editor** on a global-figure
  doc (any other signed-in user is a viewer whose edit spawns a variant client-side;
  `resolveEffectiveRole`, `apps/worker/src/db/membership.ts`), and gates the admin routes.
- **`routineCapOverride`** (INTEGER, NULL = no override) — read by the quota seam
  `routineCapFor` (`apps/worker/src/db/admin.ts`) **before** the plan default
  (`FREE_ROUTINE_CAP = 3`, `db/routines.ts`; pro = unbounded), on BOTH routine-create and
  fork. `/api/me` surfaces the effective `routineCap` + `isAdmin` flag.

**Granting is an ops action until the v1.1 admin UI exists** — a direct D1 `UPDATE` on the
`users` row:

```bash
cd apps/worker
pnpm exec wrangler d1 execute DB --env staging --remote \
  --command "UPDATE users SET isAdmin = 1 WHERE id = '<clerk sub>'"
pnpm exec wrangler d1 execute DB --env staging --remote \
  --command "UPDATE users SET routineCapOverride = 10 WHERE id = '<clerk sub>'"
# local dev: drop --env/--remote and use --local
```

**Elevation** (`account → global` re-scope, same docRef so placements survive) likewise
remains ops-driven, admin-approved (queue UI is v1.1, PLAN §11).

### Seeding the global figure catalog — admin-only route (PR #137, D30)

`POST /api/admin/seed-global-figures` (caller must be `isAdmin`; non-admin → 403) imports
the bundled catalog into **real, admin-owned global figure docs** via `seedGlobalFigures`
(`apps/worker/src/seed-global-figures.ts`). **Additive + idempotent** (D30): re-running only
creates missing figures — an existing doc is never overwritten, so admin in-app edits are
safe from a re-seed. Response reports `{ ok, created, skipped }`. This is the per-environment
ops action that stands up the catalog (staging/production) until the admin UI lands; seed
semantics live in **ballroom-flow-figure-data-pipeline** §7.

### Sample/template self-healing — no ops action needed

The app-owned "Golden Waltz Basic" template (`apps/worker/src/sample.ts`,
`APP_OWNER = "app"`, deterministic `tpl_gw_*` ids) is **lazily self-healed**:
`ensureSample` (`apps/worker/src/index.ts:56`) runs on `GET /api/templates` and the fork
route, checks *actual* D1 state (indexed `ownerId='app'` existence check, not a module
boolean), and re-seeds idempotently (no-clobber `seedDoc` + `ON CONFLICT DO NOTHING`) if
the rows are ever gone. A wiped D1 (e.g. e2e reset, or a fresh environment) heals itself
on first template read — **never seed templates by hand**.

### Secrets rotation / setup checklist

| Secret/var | Where | Command / place |
|---|---|---|
| `CLERK_SECRET_KEY` | Wrangler secret per env | `cd apps/worker && pnpm exec wrangler secret put CLERK_SECRET_KEY --env staging\|production` (no `--env` = default dev worker) |
| `CLERK_JWT_KEY` (PEM, optional) | Wrangler secret / `.dev.vars` | Enables networkless token verify; the e2e env's PEM is committed test-only |
| `VITE_CLERK_PUBLISHABLE_KEY` | GitHub Environment **variable** (+ local `.env.local`) | Public; baked into SPA at build |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | GitHub Environment **secrets** | Only deploy.yml uses them; unset = graceful deploy skip |

Full account setup (Clerk instance config, session-token claim customization for real
member names, D1 creation) lives in `PROVISIONING.md` — follow it, don't improvise.

---

## Provenance and maintenance

Verified 2026-07-02 against repo HEAD `70eed7e`; **admin/migrations sections refreshed
2026-07-02 — verified at HEAD `c9622c9`** (PR #137: migration 0014 + admin route; PR #136:
migration 0015) on `development`, by reading:
`apps/worker/wrangler.toml` (all four envs, D1 ids, committed e2e PEM, dist-e2e comment),
`.github/workflows/deploy.yml` / `screenshots.yml` / `nightly.yml`, `apps/web/e2e/serve.sh`,
commit `e71d06d` (the staging auth-bypass incident, full message), root + worker
`package.json`, `apps/web/vite.config.ts` (:8787 proxy), `apps/web/src/main.tsx`
(Clerk-key notice), `apps/worker/drizzle.config.ts`, the 15 files in
`apps/worker/migrations/` (hand-written SQL, no drizzle `meta/`; 0014/0015 read in full),
`apps/worker/src/db/admin.ts` + `src/seed-global-figures.ts` + the `/api/me` and
`/api/admin/seed-global-figures` routes, `apps/worker/src/sample.ts`
+ `src/index.ts` `ensureSample`, `scripts/gen-library.mjs` / `gen-figure-charts.mjs`
(both executed earlier this cycle: 204 figures / 147 charts, clean diff), `PROVISIONING.md`
(production `CLERK_SECRET_KEY` ⬜ TODO), and `docs/PLAN.md` D31/§9 step 6 (✅).

Re-verify drift with:

```bash
grep -n "dist-e2e\|database_id" apps/worker/wrangler.toml        # env table, D1 ids
grep -n "wrangler d1 migrations apply\|wrangler deploy" .github/workflows/deploy.yml
ls apps/worker/migrations/                                       # migration count (15)
node scripts/gen-library.mjs && node scripts/gen-figure-charts.mjs && git diff --stat  # counts + determinism
grep -n "isAdmin\|routineCapOverride" apps/worker/src/db/schema.ts   # admin columns present
grep -n "seed-global-figures" apps/worker/src/index.ts           # admin seeder route present
grep -n "CLERK_SECRET_KEY" PROVISIONING.md                       # production secret still TODO?
```
