# Tooling & Test-Harness Assessment

DevOps assessment of the Weave Steps dev tooling against [PLAN.md](PLAN.md)
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

### Type-honesty enforcement (added 2026-07-13)

CLAUDE.md §4's "keep types honest" rule is machine-enforced; the whole stack
runs from `pnpm lint` (so lefthook pre-commit and the CI lint step inherit it):

- **`lint-plugins/no-type-assertion.grit`** — a Biome GritQL lint plugin
  (`plugins` in `biome.json`) that makes every `expr as Type` and legacy
  `<Type>expr` assertion a lint **error**. `expr as const` stays legal (a
  const assertion can't lie about the runtime shape). Import/export renames
  (`import { a as b }`) are structurally excluded (AST node match, not text).
- **`biome.json` rules** — `suspicious/noExplicitAny: error` (pre-existing),
  `style/noNonNullAssertion: error` (`x!`), `suspicious/noTsIgnore: error`
  (`@ts-ignore`).
- **`scripts/check-type-suppressions.mjs`** — zero-dependency gate for what
  Biome can't express: bans `@ts-expect-error` / `@ts-nocheck` everywhere, and
  confines `biome-ignore lint/plugin:` suppressions to the allowlisted
  compiler-bypass helpers (`packages/domain/src/__fixtures__/invalid.ts`,
  `apps/web/src/test-support/test-double.ts`, `apps/worker/src/test-support/test-peek.ts`) — the sanctioned pattern for
  deliberately-invalid negative-test inputs and jsdom-incomplete test doubles.

The escape hatch for a genuine boundary (external lib's wrong types, a
validated parse) is a small named helper with a `biome-ignore lint/plugin:`
line whose comment states why the compiler can't know and what guarantees the
claim at runtime — and the helper's file must be added to the check script's
allowlist, which keeps every new bypass review-visible.

### Added (this pass)
| Area | What | Where |
|---|---|---|
| **Worker layer** | `isolatedStorage: false` (M0.5 SQLite-DO finding) + unique-DO-id convention documented; per-suite D1 migrations seam (`readD1Migrations` → `TEST_MIGRATIONS` binding); coverage (istanbul, ≥88% lines — **armed**) | `apps/worker/vitest.config.ts` |
| **EXPLAIN seam** | `expectIndexedQuery()` contract + mechanism doc; body left for the test engineer | `apps/worker/src/test-support/explain.ts` |
| **Test-binding types** | `TEST_MIGRATIONS` typed on `cloudflare:test` `ProvidedEnv` | `apps/worker/src/test-support/env.d.ts` |
| **Domain layer** | coverage (istanbul, ≥90% lines — **armed**) + `coverage` script | `packages/domain/vitest.config.ts` |
| **Component layer** | jsdom + `@testing-library/react` + `vitest-axe`; setup file (matchers, cleanup, canvas stub) | `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts` |
| **E2E layer** | Playwright config — 3 projects (`chromium-desktop`, `mobile-chrome`, `mobile-safari`), `vite preview` webServer, `retries:1`, trace-on-retry; `@smoke` tag convention | `apps/web/playwright.config.ts`, `apps/web/e2e/` |
| **Local dev** | `pnpm dev` runs web + worker together via `concurrently` | root `package.json` |
| **Git hooks** | **lefthook** pre-commit: Biome on staged files + monorepo typecheck | `lefthook.yml`, root `prepare` script |
| **CI** | layered PR fast gate (lint+typecheck → unit/property → contract/drift → worker/DO/D1 → component+axe → E2E smoke); **docs-only PRs skip it** — a cheap `changes` job detects a diff that is entirely markdown/`docs/` (excluding `docs/seed/`, generator input) and `fast-gate`/`full-e2e` skip at the job level, which satisfies branch-protection required checks, so a docs PR is mergeable in seconds | `.github/workflows/ci.yml` |
| **Nightly** | full Playwright matrix + Lighthouse-CI stub | `.github/workflows/nightly.yml` |
| **Scripts** | `dev`, `test:e2e`, `test:e2e:smoke`, `coverage` (root + web), per-package `coverage` | various `package.json` |

New dev dependencies:
- root: `concurrently`, `lefthook`
- `packages/domain`: `@vitest/coverage-istanbul`
- `apps/worker`: `@vitest/coverage-istanbul`
- `apps/web`: `@playwright/test`, `@testing-library/react`,
  `@testing-library/jest-dom`, `@testing-library/user-event`, `vitest-axe`,
  `axe-core`, `jsdom`, `@vitest/coverage-istanbul`, `@types/node`

### Coverage thresholds — ARMED (was deferred; landed with the M1/M2 suites)
- **Coverage thresholds are armed and gate every PR** — domain ≥90% lines
  (`packages/domain/vitest.config.ts`), worker ≥88% lines
  (`apps/worker/vitest.config.ts`); ratcheting toward 95/90 (PLAN.md §10.3). Web
  coverage is collected but **not yet threshold-gated** — see the readiness
  backlog. (This section previously said the thresholds were commented out until
  tests existed; the suites have long since landed.)
- **EXPLAIN QUERY PLAN helper** — implemented (`expectIndexedQuery`,
  `apps/worker/src/test-support/explain.ts`); the US-049 suites run it as a
  no-SCAN gate. (PLAN.md §7, §10.3.)

### Intentionally deferred (with milestone pointers)
- **`applyD1Migrations()`** — invoked in per-suite fixtures (`seedDb`); the
  migrations dir now carries the full ladder (17 migrations as of 2026-07-13),
  no longer empty.
- **Lighthouse-CI** — stubbed in `nightly.yml`; budgets authored in **M9**
  (PLAN.md §7 perf NFRs).
- **Sentry + Analytics Engine** — shipped in **M8** as dependency-free envelope
  reporters (no Sentry SDK): worker `apps/worker/src/ops.ts` (+ auth
  verification-failure reporting, 2026-07-05) and web `apps/web/src/lib/ops.ts`
  (`VITE_SENTRY_DSN`). See PLAN.md §7 Ops, §9 M8. Not part of the test harness.
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

## Explainer video

An **auto-generated product tour** (`apps/web/src/marketing/video/explainer.mp4` +
`explainer-poster.png`) — a real-app screencast of the authoring, commenting and
journaling journeys, stitched with intro/info/outro cards. It's embedded on the README,
the logged-out Landing page, and the empty Choreo-list state (a subtle "watch the tour"
disclosure once you already have choreos). Like the marketing **screenshots** pipeline, the
committed asset is regenerated from the *running app*, so it can't drift from reality.

**Pipeline** (`pnpm video:generate`):

1. **Record** — `pnpm video:record` runs the `@video` Playwright journey
   (`apps/web/e2e/explainer-video.spec.ts`) against the real #191 worker harness, driving
   the app through each scene and recording one `webm` per scene into
   `apps/web/remotion/public/clips/` (gitignored intermediates).
2. **Render** — `pnpm video:render` (`scripts/render-explainer.mjs`) bundles the Remotion
   project (`apps/web/remotion/`) and renders the poster still + `h264` MP4 into
   `apps/web/src/marketing/video/`.

**Single source of truth:** `apps/web/remotion/timeline.ts` defines the scene order, the
clip filenames the recorder writes, and the on-screen copy — shared by the recorder and the
composition so they can't disagree (mirrors `screenshots.manifest.ts`). The final asset's
metadata lives in `apps/web/src/marketing/video/explainer.manifest.ts`.

**CI bot** (`.github/workflows/video.yml`): on PRs that touch the
UI / worker / pipeline (path-filtered) — plus manual dispatch — CI runs `pnpm video:generate`,
then decides whether the running app **meaningfully** changed the tour. Because the MP4 is
non-deterministic (h264 encode + the recorded journey's timing/cursor jitter), a byte compare
is useless, so `scripts/video-diff.mjs` **pixel-diffs the deterministic poster frame** and
treats it as changed only when the differing fraction exceeds `VIDEO_DIFF_THRESHOLD` (default
2%). On a real change it commits the refreshed `explainer.mp4` + poster back to the PR branch
(`video-bot`, `[skip ci]` — both the message and a guard step stop the self-trigger loop) and
upserts a sticky **before/after** comment; otherwise it discards the jittered render. Remotion
downloads its own managed Chromium in CI.

> The screenshot pipeline used to work this same way but was moved off auto-commit on
> 2026-07-14 (the `screenshots` job in `ci.yml` renders + pixel-diffs, committing nothing).
> It inlines the **before / after** images in the PR comment by hosting the fresh after PNGs
> as assets on a dedicated `ci-screenshots` prerelease — a release
> tag points at an existing commit, so this adds no history and never touches the PR HEAD — and
> linking their stable `releases/download/…` URLs (GitHub strips `data:` URIs, so a comment can
> only embed an image it can fetch by URL; the committed "before" stays a raw.githubusercontent URL).
> Stale per-PR assets are pruned on each push and on PR close (`screenshot-cleanup.yml`).
> `video.yml` still auto-commits with `[skip ci]`, so it retains the footgun that motivated the
> move off auto-commit: the bot commit becomes the PR HEAD with no CI on it, so on a red PR the
> HEAD can show no failing checks. An MP4 can't be inlined in a comment, but the same
> release-asset trick could host a poster/preview; left as-is for now — revisit if it bites.

**Notes.** Remotion is a **build-only** dependency — the app embeds the rendered MP4 via a
plain `<video>` (poster + controls, `preload="none"`), so nothing heavy ships in the client
bundle. The render points Chromium at `REMOTION_BROWSER` (or the sandbox's preinstalled
headless shell, else Remotion's managed download); the recorder points at `PW_CHROMIUM_PATH` /
the preinstalled Chromium, falling back to Playwright's managed browser (CI). `@video` is
**not** in `@smoke` — the bot regenerates it; humans can too with `pnpm video:generate`.

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
