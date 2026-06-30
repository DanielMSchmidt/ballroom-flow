# Tooling & Test-Harness Assessment

DevOps assessment of the Ballroom Flow dev tooling against [PLAN.md](PLAN.md)
§10.3 ("Tooling, CI, fixtures"). Scope: the test **harness** (frameworks,
configs, CI, hooks, DX) — **not** test cases or test-helper abstractions
(factories, `seedDb`, `authedContext`, `makeTestJWT`, convergence helpers),
which the **test engineer** owns and builds on this harness.

## Summary

The M0 scaffold already had a sound base: pnpm monorepo, Biome, strict TS,
Vitest in each workspace, `vitest-pool-workers` for the Worker, Vite PWA, and a
PR CI workflow. The gaps were the **layered** test harness the plan calls for —
a component/a11y layer, a Playwright E2E matrix, coverage, the spike's
`isolatedStorage` fix, the D1-migrations + EXPLAIN seams, local dev
orchestration, and git hooks. Those are now wired and verified green with zero
test cases.

## Existed vs. Added vs. Deferred

### Already existed (M0 scaffold)
- pnpm workspaces (`pnpm-workspace.yaml`), root scripts, Node 22 (`.nvmrc`).
- Biome (`biome.json`) — `noExplicitAny: error`, formatter, organize-imports.
- Strict TS (`tsconfig.base.json`) — `strict`, `noUncheckedIndexedAccess`, ESM.
- **domain** Vitest (Node env) with `fast-check` already a devDep.
- **worker** Vitest via `@cloudflare/vitest-pool-workers` (basic config).
- **web** Vite + Vite-PWA; a `vitest run --passWithNoTests` script.
- D1 via Drizzle + `drizzle-kit`; `wrangler.toml` with staging/prod envs.
- CI (`ci.yml`) PR gate + deploy (`deploy.yml`); `PROVISIONING.md`.
- `.gitignore` already listed `coverage/`, `playwright-report/`, `test-results/`.

### Added (this pass)
| Area | What | Where |
|---|---|---|
| **Worker layer** | `isolatedStorage: false` (M0.5 SQLite-DO finding) + unique-DO-id convention documented; per-suite D1 migrations seam (`readD1Migrations` → `TEST_MIGRATIONS` binding); coverage (istanbul, ≥90% staged) | `apps/worker/vitest.config.ts` |
| **EXPLAIN seam** | `expectIndexedQuery()` contract + mechanism doc; body left for the test engineer | `apps/worker/src/test-support/explain.ts` |
| **Test-binding types** | `TEST_MIGRATIONS` typed on `cloudflare:test` `ProvidedEnv` | `apps/worker/src/test-support/env.d.ts` |
| **Domain layer** | coverage (istanbul, ≥95% staged) + `coverage` script | `packages/domain/vitest.config.ts` |
| **Component layer** | jsdom + `@testing-library/react` + `vitest-axe`; setup file (matchers, cleanup, canvas stub) | `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts` |
| **E2E layer** | Playwright config — 3 projects (`chromium-desktop`, `mobile-chrome`, `mobile-safari`), `vite preview` webServer, `retries:1`, trace-on-retry; `@smoke` tag convention | `apps/web/playwright.config.ts`, `apps/web/e2e/` |
| **Local dev** | `pnpm dev` runs web + worker together via `concurrently` | root `package.json` |
| **Git hooks** | **lefthook** pre-commit: Biome on staged files + monorepo typecheck | `lefthook.yml`, root `prepare` script |
| **CI** | layered PR fast gate (lint+typecheck → unit/property → contract/drift → worker/DO/D1 → component+axe → E2E smoke) | `.github/workflows/ci.yml` |
| **Nightly** | full Playwright matrix + Lighthouse-CI stub | `.github/workflows/nightly.yml` |
| **Scripts** | `dev`, `test:e2e`, `test:e2e:smoke`, `coverage` (root + web), per-package `coverage` | various `package.json` |

New dev dependencies:
- root: `concurrently`, `lefthook`
- `packages/domain`: `@vitest/coverage-istanbul`
- `apps/worker`: `@vitest/coverage-istanbul`
- `apps/web`: `@playwright/test`, `@testing-library/react`,
  `@testing-library/jest-dom`, `@testing-library/user-event`, `vitest-axe`,
  `axe-core`, `jsdom`, `@vitest/coverage-istanbul`, `@types/node`

### Intentionally deferred (with milestone pointers)
- **Coverage thresholds are configured but commented out** in the domain
  (≥95%) and worker (≥90%) Vitest configs. A coverage gate on **zero** product
  code fails an empty suite, so the threshold numbers are present and the test
  engineer uncomments them once the M1/M2 suites land. (PLAN.md §10.3.)
- **EXPLAIN QUERY PLAN helper body** — the seam + contract + mechanism are set
  up (`expectIndexedQuery`); the implementation is the test engineer's, built on
  their per-suite D1 fixture. (PLAN.md §7, §10.3.)
- **`applyD1Migrations()` invocation** — the harness reads migrations and
  exposes them as `env.TEST_MIGRATIONS`; *calling* `applyD1Migrations` in a
  per-suite `beforeAll` belongs to the test engineer's fixtures (`seedDb`).
  Migrations dir is empty until **M2**.
- **Lighthouse-CI** — stubbed in `nightly.yml`; budgets authored in **M9**
  (PLAN.md §7 perf NFRs).
- **Sentry (`@sentry/cloudflare`) + Analytics Engine** — observability wiring is
  **M8** (PLAN.md §7 Ops, §9 M8). Not part of the test harness.
- **Real-browser component testing** — the component layer uses jsdom (fast,
  deterministic) for Testing Library + axe; true cross-browser + PWA
  install/offline coverage is the Playwright E2E layer (M9).

## Key decisions & rationale

- **lefthook over husky + lint-staged.** One binary + one `lefthook.yml`
  replaces husky's shell shims *and* lint-staged's globbing, runs commands in
  parallel, and has built-in `{staged_files}` templating. Fewer moving parts for
  the same outcome (Biome on staged files + typecheck pre-commit).
- **jsdom for the component layer.** `@testing-library/react` + `vitest-axe`
  run fully in jsdom; this keeps the component suite fast and free of browser
  binaries. "Browser env" in the plan is satisfied by a DOM; real-browser
  fidelity is the E2E layer's job. JSX is transformed by Vitest's esbuild
  (React 19 automatic runtime), so the component config needs no
  `@vitejs/plugin-react` — which also sidesteps the app-vite vs vitest-vite
  version clash.
- **`isolatedStorage: false` + unique DO ids.** Direct from the M0.5 spike:
  SQLite-backed DOs break vitest-pool-workers' isolated-storage teardown. With
  isolation off, storage is **not** reset between tests, so every test must use
  a unique DO id (see DEVELOPMENT.md). Confirmed: the worker now boots a
  "single runtime" and the existing tests pass.
- **`vite preview` (not `vite dev`) as the E2E webServer.** Serves the built
  PWA assets + service worker, matching production for install/offline tests.

## Verification

All commands run clean from a `--frozen-lockfile` install (full outputs in the
handoff). Layer harnesses were each proven with a throwaway test that was then
deleted (no test cases left behind):
- `pnpm lint` → clean.
- `pnpm typecheck` → all 4 workspaces pass.
- `pnpm -r build` → web builds (PWA SW generated).
- `pnpm test` → domain/web collect with no tests (exit 0); worker runs its 3
  existing tests in `workerd` green.
- Component harness (jsdom + RTL + axe `toHaveNoViolations`) — proven, deleted.
- Playwright `chromium-desktop` + `mobile-safari` (webkit) smoke vs the preview
  server — proven, deleted.
- `pnpm exec lefthook run pre-commit` → biome + typecheck both pass.
