# Development Guide

How to install, run, and test Weave Steps locally. Architecture is in
[system/architecture.md](system/architecture.md); account/secret provisioning is in
[PROVISIONING.md](../PROVISIONING.md); the test-harness rationale is in
[TOOLING.md](TOOLING.md).

## Prerequisites

- **Node 22** (`.nvmrc`) — `nvm use`.
- **pnpm 11** — `corepack enable` then `corepack prepare pnpm@11 --activate` (the exact version is pinned via `packageManager` in the root `package.json`).

## Install

```bash
pnpm install
```

This also installs the git hooks (root `prepare` → `lefthook install`). To run
E2E tests you additionally need the Playwright browsers (one-time):

```bash
pnpm --filter web exec playwright install chromium webkit
```

## Run locally (web + worker together)

```bash
pnpm dev
```

Runs both services with `concurrently`:
- **web** (Vite) on <http://localhost:5173> — proxies `/api/*` → `:8787`.
- **worker** (`wrangler dev`) on <http://localhost:8787> — Hono API + local D1
  (Miniflare) + Durable Objects in local `workerd`.

Run one side alone: `pnpm --filter web dev` or `pnpm --filter worker dev`.

## Environment & secrets

Two local files, both git-ignored (see PROVISIONING.md for how to obtain keys):

- **`apps/web/.env.local`** — the Vite-exposed **publishable** Clerk key, baked
  into the SPA at build time:
  ```
  VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx
  ```
  Without it, the SPA renders a "set your Clerk key" first-run notice instead of
  sign-in.
- **`apps/worker/.dev.vars`** — the Worker's local secrets (e.g.
  `CLERK_SECRET_KEY`, optional `CLERK_JWT_KEY` PEM for networkless verify).
  `wrangler dev` and the worker test harness load this automatically. In
  deployed environments these are **Wrangler secrets**, set per env
  (`wrangler secret put … --env staging|production`).

The codebase builds, typechecks, lints, and tests **without any external
accounts** — auth is tested on its negative path; the Worker tests run on local
`workerd`.

## Test layers

Run everything: `pnpm test` (all unit/component/worker suites; **not** E2E).

> **Suites run one at a time.** `pnpm test` and `pnpm coverage` pass
> `--workspace-concurrency=1` to `pnpm -r`, so the four workspace suites run
> **sequentially**, each getting the whole machine. Each vitest still parallelizes
> its own files across CPU cores — but running all four suites at once meant four
> vitest instances each spawning a CPU-sized worker pool, oversubscribing the
> cores and starving load-sensitive tests (e.g. the axe sweeps, which are
> O(DOM nodes)) into timeout *flakes* under load. Serializing costs a little
> wall-time and buys determinism. Need a single layer fast? Run it directly, e.g.
> `pnpm --filter web test`.

| Layer | Command | Stack |
|---|---|---|
| **Domain** (unit/property) | `pnpm --filter @weavesteps/domain test` | Node + `fast-check` + in-memory Automerge |
| **Worker / DO / D1** | `pnpm --filter worker test` | real `workerd` via `vitest-pool-workers` |
| **Component + a11y** | `pnpm --filter web test` | jsdom + Testing Library + `vitest-axe` |
| **E2E** | `pnpm test:e2e` | Playwright (3 device projects) |
| **E2E smoke only** | `pnpm test:e2e:smoke` | Playwright, `@smoke`-tagged tests |

Watch mode: `pnpm --filter <pkg> test:watch`. Coverage: `pnpm coverage` (root)
or per package — istanbul; thresholds are **armed and gate every PR** (domain
≥90% lines, worker/DO ≥88% lines; ratcheting toward 95/90 — see
[system/testing.md](system/testing.md) and TOOLING.md).

### E2E (Playwright)

Three projects: `chromium-desktop`, `mobile-chrome`, `mobile-safari`. The config
auto-starts the preview server (`vite preview`) — build first so there's
something to serve:

```bash
pnpm --filter web build
pnpm test:e2e                                   # full 3-device matrix
pnpm test:e2e:smoke                             # @smoke subset (CI PR gate)
pnpm --filter web exec playwright test --project=chromium-desktop   # one project
```

Tag fast journeys with `@smoke` so they run in the PR gate; the full matrix runs
nightly (`.github/workflows/nightly.yml`).

## Conventions the test engineer must know

### Per-test Durable Object id (worker layer) — REQUIRED

`apps/worker/vitest.config.ts` sets **`isolatedStorage: false`** because
SQLite-backed DOs break vitest-pool-workers' isolated-storage teardown (it
asserts on the `.sqlite` file and chokes on the `-shm`/`-wal` sidecars — M0.5
finding). Consequence: **storage is NOT reset between tests.** Every test MUST
address a **unique DO id/name** so state never leaks between tests:

```ts
import { env } from "cloudflare:test";
// Unique per test — derive from the test name or a fresh ULID.
const id = env.DOC_DO.idFromName(`routine-${crypto.randomUUID()}`);
const stub = env.DOC_DO.get(id);
```

Never share a DO id across tests, and don't rely on a "fresh" DO between tests.

### Per-suite D1 + `applyD1Migrations()`

Migrations under `apps/worker/migrations/` are read at config time and exposed
to tests as the **`env.TEST_MIGRATIONS`** binding (typed via
`apps/worker/src/test-support/env.d.ts`). Apply them per suite:

```ts
import { applyD1Migrations, env } from "cloudflare:test";
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
```

(M2 landed the D1 schema — `apps/worker/migrations/` now holds the real,
numbered `.sql` files `applyD1Migrations` replays per suite; `readD1Migrations`
returning `[]` was only ever the pre-M2 bootstrap state.) The `seedDb` /
`authedContext` fixtures build on top of this.

### EXPLAIN QUERY PLAN gate

The NFR "index every D1 query" is enforced via
`apps/worker/src/test-support/explain.ts`, which defines the
`expectIndexedQuery(db, sql, params)` **seam** — its contract + the EXPLAIN
mechanism are documented there; the **body is yours to implement** on the
per-suite D1 fixture. CI already runs the worker/D1 suite, so the gate goes live
the moment a test calls it.

### Automerge cannot store `undefined` (domain doc builders)

Automerge throws when a value is `undefined` — `RangeError: Cannot assign
undefined value at /path` — at `A.from(...)` and inside `A.change(...)`. Our
logical doc shapes carry optional fields (e.g. `counts`,
`baseFigureRef`, `part`) that POJOs/fixtures often
leave `undefined`, so feeding them straight into Automerge fails. The domain doc
builders therefore **strip `undefined`-valued keys before `A.from`** (JSON
drop-the-key semantics — an absent optional simply isn't set, and reads still
return `undefined` for it). **`null` is preserved**, because `deletedAt: null` is
a meaningful tombstone value the CRDT must keep. This is centralized in
`packages/domain/src/doc-internal.ts` (`stripUndefined`); any new code that feeds
a POJO into Automerge must go through it (or sanitize `undefined` the same way).

```ts
// ✗ throws if section.deletedAt or another optional field is `undefined`
A.from({ sections });
// ✓ builders run stripUndefined(structuredClone(input)) first
buildRoutineDoc(routine); // safe — undefined keys dropped, null kept
```

### Automerge 3.x: clone before reusing a doc; assert convergence via heads

Two more Automerge-3.x sharp edges that recur in undo (US-010) and the DO/sync
layer (M2). One already caused a real flaky test in US-009; both are easy to trip.

**1. A doc is "outdated" after `change`/`merge`/`applyChanges` — clone before reusing it.**
Automerge 3.x invalidates the *input* document of any mutating op. Reusing the
same reference for a second branch (e.g. building two replicas from one base, or
folding changes onto a base twice) throws `RangeError: Attempting to change an
outdated document. Use Automerge.clone()`. **Fix: `A.clone(base)` before each
independent reuse.** (`cloneRoutine` already does this for the fork path.)

```ts
// ✗ second use of `base` throws — it was outdated by the first change
const left = A.change(base, (d) => { … });
const right = A.change(base, (d) => { … });   // RangeError
// ✓ clone for each independent branch
const left = A.change(A.clone(base), (d) => { … });
const right = A.change(A.clone(base), (d) => { … });
```

**2. `save()` bytes are NOT canonical across merge order — assert convergence via heads.**
Two docs with identical logical state (same heads, same `toJS`) can serialize to
**different `save()` bytes** depending on the order changes were merged. So a
`save()`-byte comparison is a flaky false-negative for convergence. **Assert
convergence with sorted `getHeads(doc)`** (the change-hash set — order-independent),
never with `save()` bytes. `save()`-byte equality is only valid for a *single*
doc round-trip (`save`→`load`→`save`, e.g. M2 SQLite rehydration). The convergence
helper (`packages/domain/src/__fixtures__/convergence.ts`) exposes `assertHeadsEqual`
for this; `assertBytesEqual` there is for single-doc round-trips only.

## Git hooks

`pnpm install` installs a **lefthook** pre-commit hook that runs, in parallel:
- **Biome** (`check --write`) on staged JS/TS/JSON, re-staging any autofixes;
- **typecheck** across the monorepo.

Run it manually: `pnpm exec lefthook run pre-commit`. Bypass once (use
sparingly): `git commit --no-verify`. The hook is a fast local pre-flight — the
PR CI gate (`.github/workflows/ci.yml`) is the source of truth.

## Branch & deploy

`development` → **staging**, `main` → **production**. Fixes/chores/docs PR into
`main`; `docs/ideas/` implementation work PRs into `development` (promoted to
`main` in a release PR when ready). `sync-development.yml` auto-merges every
`main` push into `development` (merge, not rebase — stacked PRs must survive)
and dispatches the staging deploy. PRs run the CI fast gate; pushes to the two
long-lived branches re-run checks then deploy (see `deploy.yml` +
PROVISIONING.md).
