# Testing strategy

*What we test where, and what "done" means. The per-feature coverage matrix is
[`docs/TEST-MAP.md`](../TEST-MAP.md); harness conventions and commands are in
[`docs/DEVELOPMENT.md`](../DEVELOPMENT.md); deeper guidance in the
`ballroom-flow-validation-and-qa` skill.*

## Philosophy

Push correctness down the pyramid. The CRDT document graph makes **convergence, cross-document
sync, variant/fork resolution, per-document permissions, and quota** the top risks — each is
owned by the cheapest layer that can actually prove it. Trace every surface; color is never
the only signal (a11y is a test concern, not a polish pass).

## The delivery model — E2E journeys define "done"

Every feature ships **gated on its Playwright journey** (`apps/web/e2e/*.spec.ts`): `@smoke`
runs on every PR, the full 3-project matrix (chromium-desktop, mobile-chrome, mobile-safari)
nightly. A feature is done **only when its journey is green on the PR** — not when its unit
tests pass. *(Why: the first three milestones shipped unit-green with zero verified browser
journeys, and hydration/seeding/auth bugs only browser journeys could catch shipped with
them. Don't relitigate this.)* Every [idea](../ideas/README.md) names its ship-gate journey
up front.

TDD is not optional: write or unskip the covering test first, watch it fail, make it pass.

## Layer ownership

- **Unit / property (pure `packages/domain`, in-memory Automerge):** timing math; variant
  resolution (per-beat ownership, copy-down, spawn — including the Passing Tumble Turn
  scenario); fork-copy; family-note resolution; convergence/commutativity/idempotence
  (fast-check over shuffled/partitioned changes, including across forks); history-based undo
  (own-change inverse, remote edits preserved, redo); registry/Zod (dance gates, enum
  rejection vs read tolerance, alias normalization, custom-kind merge); Both-write derivation
  (mirror maps are involutions); the migration ladder.
- **Worker / DO / D1 (`vitest-pool-workers`, real workerd):** two clients converge through a
  real per-document DO; multi-doc references sync; the permission boundary per role per doc
  type (including forged connections, post-connect role refresh, and the account doc's
  owner-only boundary); variant-spawn on non-admin global edits; quota + cap override;
  invite lifecycle; DO SQLite persistence across eviction; alarm compaction + every D1
  projection (parity, tombstone transitions, idempotent re-runs); **EXPLAIN QUERY PLAN on
  every D1 query** (`expectIndexedQuery` — index, no SCAN).
- **Component (browser + Testing Library + axe):** editor surfaces driven from the registry;
  role-lens behavior; library badges; gating by role; toasts; axe passes on every surface.
- **E2E (Playwright):** the journeys — authoring, two-context live convergence, fork
  independence (origin edits never reach the fork; catalog refs stay live), figure-edit
  propagation across routines, variant-spawn + base-edit flow-in on unowned beats only,
  bookmarks (two users sharing one doc), cross-dance family notes + co-member visibility,
  per-user undo across clients, permission rejection, quota, invites, offline editing,
  zombie-socket recovery, PWA install + offline shell.
- **Contract:** `typeof app` + shared types (drift fails `tsc`); runtime Zod; schema-drift
  CI gate.

## Tooling & CI

- Vitest projects: `domain` (Node + fast-check), `worker` (`vitest-pool-workers` — real DOs
  + D1; **`isolatedStorage: false` + a unique DO id per test**, because SQLite-backed DOs
  break isolated-storage teardown), `component` (browser + vitest-axe).
- Per-suite isolated D1 + `applyD1Migrations()`; Clerk test JWKS + `makeTestJWT`; no sleeps;
  deterministic auth + seed; convergence asserted by exchanging changes (heads-based);
  `retries: 1` + trace.
- **CI (PR fast gate):** lint → typecheck → domain coverage → build → worker coverage → web
  tests → chromium `@smoke` E2E (including one convergence and one fork/variant journey).
  **Docs-only PRs skip the gate**: a diff that is entirely markdown/`docs/` (excluding
  `docs/seed/`, which is generator input) skips the fast-gate/E2E jobs at the job level —
  branch-protection checks stay satisfied, so a docs PR merges in seconds. Nightly: the
  full Playwright matrix.
- **Coverage thresholds are armed:** domain ≥ 90% lines (target 95), worker ≥ 88% (target
  90). Ratchet up, never down.
- **Never weaken a test to make it pass.** Flakes get root-caused, not retried or loosened;
  deleting/skipping a test needs the same justification as deleting the feature it covers.

## Fixtures

A read-only sample routine + a small shared figure library (including a variant), defined
once and reused; pure factories; `seedDb(...)` for D1 + seeded docs; `authedContext(role)`;
the typed `importDomain()` shim for safely importing not-yet-built domain exports in skipped
tests (a top-level import of a missing export breaks collection even when skipped — use
`import type` or a dynamic import inside the test body). Locations:
`packages/domain/src/__fixtures__/`, `apps/worker/src/test-support/`,
`apps/web/e2e/support/`.
