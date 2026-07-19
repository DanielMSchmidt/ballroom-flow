---
name: ballroom-flow-build-and-env
description: Load when setting up the Weave Steps environment from scratch, when pnpm install / build / typecheck / lint / test / coverage fails or behaves differently than the docs claim, when a Playwright browser download fails in a sandbox, or when you need to know which secrets exist and what runs with zero secrets. Covers toolchain pins, the verified command table, the pnpm 11 allowBuilds trap, CI parity, and known doc-vs-reality discrepancies.
---

# Weave Steps — build & environment runbook

Every command, number, and path in this file was **executed and observed on 2026-07-02**
(repo HEAD `70eed7e` on `development`) in a fresh sandbox. Where `docs/DEVELOPMENT.md`
or `docs/TOOLING.md` disagree with this file, **the docs are stale** — see §7 for the
exact discrepancies and how to re-verify each one.

**When NOT to use this:**
- Starting the dev server, seeding data, deploying, or operating staging/production → **ballroom-flow-run-and-operate**.
- Writing or debugging tests (harness conventions, DO-id rules, convergence assertions) → **ballroom-flow-validation-and-qa**.
- CI/tooling *design* rationale or adding new tooling → **ballroom-flow-diagnostics-and-tooling**.
- Architecture/module-boundary questions → **ballroom-flow-architecture-contract**.

---

## 1. From-zero setup

```bash
# 1. Node 22 — pinned by .nvmrc (contents: "22") and package.json engines >=22.
nvm use            # or ensure `node --version` reports v22.x

# 2. pnpm 11.9.0 — pinned by "packageManager": "pnpm@11.9.0" in package.json.
corepack enable    # corepack picks up the packageManager pin automatically

# 3. Install (observed: ~15s cold, 629 packages, exit 0).
pnpm install
```

**Doc trap:** `docs/DEVELOPMENT.md` (Prerequisites) and older notes say **pnpm 10**
(`corepack prepare pnpm@10`). That is stale — the actual pin is **pnpm 11.9.0**
(upgrade PR #8; the comment at the top of `pnpm-workspace.yaml` confirms it).
Use the `packageManager` pin, not the docs.

### What `pnpm install` does beyond node_modules

- Root `prepare` script runs `lefthook install`, which syncs **both** git hooks from
  `lefthook.yml`:
  - **pre-commit**: `biome check --write` on staged JS/TS (re-stages autofixes) +
    full-monorepo `pnpm -r typecheck`, in parallel.
  - **pre-push**: blocks direct pushes to `main` **and** `development` (the latter no
    longer exists as a branch — deleted 2026-07-05, `lefthook.yml`'s rule just hasn't been
    trimmed) — branch off `main` and open a PR (see **ballroom-flow-change-control**).

### The pnpm 11 build-script allowlist trap

pnpm 11 does **not** read `pnpm.onlyBuiltDependencies` from package.json. The
allowlist is the **`allowBuilds` map in `pnpm-workspace.yaml`** (package → boolean):

| Package | allowBuilds | Why |
|---|---|---|
| `esbuild` | true | vite builds |
| `lefthook` | true | git hooks |
| `workerd` | true | worker/DO tests + dev |
| `wrangler` | true | dev/deploy |
| `@clerk/shared`, `@swc/core`, `sharp` | false | ran no build under pnpm 10 either; app works without |

**Trap:** if you add a new dependency that has a postinstall/build script, pnpm 11
**silently skips its build** unless you add it to `allowBuilds`. Symptom: the package
installs "fine" but its native binary / generated artifact is missing at runtime.
When adding a dep, check for a build script and add an explicit `true`/`false` entry.

---

## 2. Verified command table (all offline, zero secrets)

All run from the repo root. Durations are one cold run on 2026-07-02 — treat as
order-of-magnitude, not SLA.

| Command | Observed result (2026-07-02) | Duration |
|---|---|---|
| `pnpm build` | Exit 0. **Only `apps/web` has a build script** (`tsc --noEmit` + `vite build` → `apps/web/dist`). ~890 kB JS + 2.75 MB Automerge WASM; a chunk-size warning is **normal**; PWA `sw.js` generated, precache ~3596 KiB. domain/contract/worker build nothing. | 13.3s |
| `pnpm typecheck` | Exit 0 across all 4 workspaces (`pnpm -r typecheck`). | 12.2s |
| `pnpm lint` | Exit 0, 285 files, ~350ms. **No warnings** at HEAD `c9622c9` (the old `fork.test.ts:282` baseline warning is gone). | 1.3s |
| `pnpm test` | At HEAD `c9622c9` (2026-07-02, post-#139/#136/#137): **all green, exit 0** — **domain 245 passed / 3 skipped** (23 files; skips = `seed-library.test.ts`, US-054); **contract 14 passed**; **web 343 passed / 0 skipped** (41 files, jsdom); **worker 180 passed / 7 skipped**. Worker tests run in **real workerd** via vitest-pool-workers — the ~55s is genuine; under heavy sandbox load `starter.test.ts` can hit its 5s timeout (environmental; passes in isolation). | ~90s total |
| `pnpm coverage` | Exit 0. Thresholds are **armed** — a drop below any floor fails. Per-metric floors, measured actuals, and ratchet semantics are single-homed in **ballroom-flow-validation-and-qa** §6. | 65.7s |
| `node scripts/gen-library.mjs` / `node scripts/gen-figure-charts.mjs` | Both exit 0 — offline, byte-deterministic (`git diff` stays empty on unchanged seeds). Output counts, seed semantics, and the charting workflow: **ballroom-flow-figure-data-pipeline**. | seconds |
| `pnpm --filter web exec playwright test --list` | 87 tests in 14 files across 3 projects; with `--grep @smoke --project=chromium-desktop` → 24 tests. | ~5s |

**Coverage thresholds are ARMED at the measured floors** (domain 90 lines, worker 88
lines, web none) — docs claiming they're "commented out" are stale;
`pnpm --filter @weavesteps/domain coverage` and `pnpm --filter worker coverage` fail
below them. CLAUDE.md's "domain ≥95%, worker ≥90%" figures are NOT stale numbers:
they are the **`docs/system/testing.md` § Tooling & CI ratchet TARGETS** — ratchet the config floors *up* toward
them as coverage rises, never down. The full per-metric table, measured actuals, and
ratchet semantics live in **ballroom-flow-validation-and-qa** §6.

---

## 3. Secrets matrix + the zero-secret guarantee

**Verified guarantee:** `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint`,
`pnpm test`, `pnpm coverage`, both generators, **and the chromium E2E smoke suite**
all pass with **no env files and no external accounts**. Don't chase missing secrets
to explain a failure in any of those — the cause is elsewhere.

Secrets matter only for real sign-in in dev, deployed environments, and deploys:

| Var (names only — values per `PROVISIONING.md`) | Where it lives | Needed for |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | `apps/web/.env.local` (local); GH Actions **variable** per environment | Real sign-in in the dev/deployed SPA only |
| `CLERK_SECRET_KEY` | `apps/worker/.dev.vars` (local); `wrangler secret put CLERK_SECRET_KEY --env staging\|production` | Worker auth positive path / deployed API |
| `CLERK_JWT_KEY` (PEM, optional) | `.dev.vars` / wrangler secret; a **committed throwaway test key** lives in `apps/worker/wrangler.toml` `[env.e2e.vars]` | Networkless JWT verify; E2E |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Environments `staging` / `production` | `deploy.yml` only (it skips deploy with a notice if unset) |
| `SENTRY_DSN` | wrangler secret per env (worker reporter `apps/worker/src/ops.ts`) | Worker error reporting (US-049); silent no-op unset |
| `VITE_SENTRY_DSN` | GitHub env **variable**, baked by `deploy.yml` (web reporter `apps/web/src/lib/ops.ts`, added 2026-07-05) | Client error reporting (US-049 web half); silent no-op unset |

**There is no `.env.example` or `.dev.vars.example`.** Write `apps/web/.env.local`
and `apps/worker/.dev.vars` by hand following `PROVISIONING.md`. Dev-server and
deploy specifics → **ballroom-flow-run-and-operate**.

---

## 4. Sandbox / E2E environment traps

The E2E harness itself (what `e2e/serve.sh` does, how tests are written) belongs to
**ballroom-flow-validation-and-qa** / **ballroom-flow-run-and-operate**. This section
is only about making the *environment* able to run it.

### Playwright browser version mismatch (sandboxes)

- The lockfile installs **@playwright/test 1.61.1** (package.json range `^1.50.1` —
  check the installed version, not the range), which wants **chromium build 1228**.
- Sandbox image ships `/opt/pw-browsers` with build **1194** only.
- `pnpm --filter web exec playwright install chromium` **fails with a proxy 403**
  (cdn.playwright.dev not permitted). Do not retry it; shim instead.

**Verified workaround** — `/opt/pw-browsers` is writable; alias 1228 to 1194:

```bash
mkdir -p /opt/pw-browsers/chromium_headless_shell-1228/chrome-headless-shell-linux64
ln -sf /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell \
  /opt/pw-browsers/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell
touch /opt/pw-browsers/chromium_headless_shell-1228/INSTALLATION_COMPLETE
touch /opt/pw-browsers/chromium_headless_shell-1228/DEPENDENCIES_VALIDATED
```

With the shim, this passed offline against real workerd (2026-07-02):

```bash
cd apps/web && pnpm exec playwright test --grep @smoke --project=chromium-desktop
# → 22 passed / 2 skipped (pwa-a11y, M9), ~55s
```

### Other E2E environment facts

- **webkit (`mobile-safari` project) cannot run in sandboxes** — not installed,
  downloads blocked. Root `pnpm test:e2e` / `pnpm test:e2e:smoke` run all 3 projects;
  always pass `--project=chromium-desktop` in a sandbox.
- E2E is fully self-contained: `apps/web/e2e/serve.sh` builds an auth-bypass bundle
  (`VITE_E2E=1`) into **`dist-e2e`** (never deploy that dir), resets a fresh local D1,
  and runs `wrangler dev --env e2e` on port **4173** (override with `E2E_PORT` to
  avoid worktree port collisions — `apps/web/playwright.config.ts:12`).
- Do not run the full E2E matrix casually; it is serialized (`workers:1`, shared D1).

### Expected harmless noise (do not debug these)

Scary-looking but harmless output — wrangler telemetry 403s, workerd `Broken pipe`
at E2E shutdown, the jsdom `Failed to parse URL` stderr, the deliberate
alarm-projection error-path log, and the Vite chunk-size warning — is catalogued
once, with interpretations, in **ballroom-flow-diagnostics-and-tooling** §3.
(`pnpm lint` is warning-free at HEAD `c9622c9`.) If a run's exit
code and test verdicts are green, check that table before debugging any log line.

---

## 5. CI parity (`.github/workflows/ci.yml` fast gate, runs on PRs)

Reproduce any CI failure locally with the matching command:

| ci.yml step | Local equivalent |
|---|---|
| `pnpm install --frozen-lockfile` | same (lockfile drift fails here) |
| Lint | `pnpm lint` |
| Typecheck (+ contract drift) | `pnpm -r typecheck` |
| Unit/property + coverage (domain) | `pnpm --filter @weavesteps/domain coverage` |
| Build | `pnpm -r build` |
| Worker/DO/D1 + coverage (workerd) | `pnpm --filter worker coverage` |
| Component + a11y (web) | `pnpm --filter web test` |
| Install Playwright (chromium) | `pnpm --filter web exec playwright install --with-deps chromium` (in sandboxes: use the §4 shim instead) |
| E2E smoke (chromium) | `pnpm --filter web exec playwright test --project=chromium-desktop --grep @smoke` |

Node 22 via `actions/setup-node`; pnpm version from the `packageManager` pin —
same toolchain as §1, so "works locally, fails in CI" is almost never a version skew.

Related workflows: `deploy.yml` re-runs lint/typecheck/build/`pnpm -r test`/chromium
smoke, then `wrangler d1 migrations apply DB --env <env> --remote` + `wrangler deploy
--env <env>` (skips gracefully without `CLOUDFLARE_API_TOKEN`); `nightly.yml` runs
the full 3-device E2E matrix; the `screenshots` job in `ci.yml` renders + pixel-diffs the
landing screenshots and posts an artifact-backed before/after PR comment (no auto-commit).
Operating deploys → **ballroom-flow-run-and-operate**.

---

## 6. Generated files

`node scripts/gen-library.mjs` and `node scripts/gen-figure-charts.mjs` rewrite
**checked-in** generated files (`packages/domain/src/library-data.ts`,
`packages/domain/src/figure-charts.generated.ts`) deterministically. After running
one, `git diff --stat` must be empty unless you changed the inputs. Details →
**ballroom-flow-figure-data-pipeline**.

`scripts/screenshot-diff.mjs` is CI-only (needs PR context; used by the `screenshots`
job in `ci.yml`). `scripts/screenshot-diff.test.mjs` is a vitest test wired into
**no runner** — `node --test` on it fails with `ERR_MODULE_NOT_FOUND vitest`; that
is a known orphan, not your breakage.

---

## 7. Docs-vs-reality: trust this table over the docs

CLAUDE.md declares divergence between docs and code a bug — these six were confirmed
live on 2026-07-02. Until the docs are fixed, believe the "Reality" column, and
re-verify with the one-liner if you suspect drift.

| # | Doc claim | Reality (verified 2026-07-02) | Re-verify |
|---|---|---|---|
| 1 | `docs/DEVELOPMENT.md:10` + CLAUDE.md: **pnpm 10** | Pin is **pnpm 11.9.0** | `grep packageManager package.json` |
| 2 | `docs/TOOLING.md:56` / `DEVELOPMENT.md:73`: coverage thresholds "commented out"; CLAUDE.md: "uncomment when suites land" | **Armed** at the measured floors: domain 90 lines, worker 88 lines. (CLAUDE.md's 95/90 figures are the `docs/system/testing.md` § Tooling & CI ratchet *targets*, not stale claims — full table: **ballroom-flow-validation-and-qa** §6) | `grep -A5 thresholds packages/domain/vitest.config.ts apps/worker/vitest.config.ts` |
| 3 | `docs/DEVELOPMENT.md:123`: "migrations dir is empty until M2" | **15 migrations** exist | `ls apps/worker/migrations \| wc -l` |
| 4 | `DEVELOPMENT.md:78` / `TOOLING.md:40`: E2E webServer is `vite preview`, "build first" | webServer is **`e2e/serve.sh`** — self-building, real wrangler-dev backend | `grep -n serve.sh apps/web/playwright.config.ts` |
| 5 | `docs/TEST-MAP.md:11`: domain 154 / web 114 / worker 101 tests | **245 / 355 / 180** (as of 2026-07-02, HEAD `759b3a8`) | `pnpm test` and read the summaries |
| 6 | (implied by its existence) `scripts/screenshot-diff.test.mjs` runs somewhere | Wired into **no runner**; orphaned | `grep -rn "screenshot-diff.test" package.json apps/*/package.json .github/workflows/` |

If you touch one of these areas, fixing the stale doc line in the same PR is the
expected move (see **ballroom-flow-change-control**).

---

## Provenance and maintenance

- **Date-stamp:** 2026-07-02, repo HEAD `70eed7e`; test/lint/migration rows refreshed same
  day — **verified at HEAD `c9622c9`** (post-#139/#136/#137; all suites green, `pnpm test`
  exits 0) on `development`.
- **Verified against:** live execution of every command in §2 in a fresh sandbox on
  2026-07-02; direct reads of `package.json`, `.nvmrc`, `pnpm-workspace.yaml`,
  `lefthook.yml`, `packages/domain/vitest.config.ts`, `apps/worker/vitest.config.ts`,
  `apps/web/package.json`, `apps/web/playwright.config.ts`, `apps/web/e2e/serve.sh`,
  `apps/worker/wrangler.toml`, `.github/workflows/ci.yml` + `deploy.yml`,
  `PROVISIONING.md`, and the stale doc lines cited in §7. The Playwright shim in §4
  was applied and the smoke suite observed passing (22 passed / 2 skipped, 55s).
- **Volatile facts** (re-verify before relying on exact numbers):
  - Toolchain pins: `cat .nvmrc && grep packageManager package.json`
  - Build allowlist: `grep -A10 allowBuilds pnpm-workspace.yaml`
  - Coverage thresholds: `grep -A5 thresholds packages/domain/vitest.config.ts apps/worker/vitest.config.ts`
  - Test/skip counts: `pnpm test` (counts in §2 are a 2026-07-02 snapshot)
  - Playwright pin: `node -e "console.log(require('@playwright/test/package.json').version)"` from `apps/web`
  - Lint baseline: `pnpm lint` (expect zero warnings)
  - CI steps: `grep -n "run:" .github/workflows/ci.yml`
