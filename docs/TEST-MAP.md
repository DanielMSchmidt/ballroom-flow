# Test Map — US → test file × layer

**Status:** Skipped TDD suite authored ahead of the build (RED→GREEN→REFACTOR).
Every test is `describe.skip` / `test.skip` so the suite is GREEN (all skipped,
zero failures) until the product modules land. Source of truth for "what GREEN
means" is each skipped test's header comment (US-ID, intent, multi-user
scenario, arrange/act/assert, acceptance criteria + PLAN §10.2 invariant).

**How the skipped tests stay parsable** (no product code exists yet): tests
never top-level-import a not-yet-built product export. They use typed dynamic
imports through small shims that defer module resolution to runtime:

- domain: [`importDomain()`](../packages/domain/src/__fixtures__/domain-api.ts)
  — typed `DomainApi` surface (the M1 contract);
- worker: HTTP via `SELF.fetch` + the structural
  [`DocStub`](../apps/worker/src/test-support/doc-do-api.ts) DO surface;
- web: [`importComponent<T>()`](../apps/web/src/test-support/import-component.ts)
  + the [`./routine` store shim](../apps/web/src/store/routine-store.test.ts);
- Automerge is loaded lazily inside the convergence helper (it is not yet a dep —
  see "Missing dependencies").

## Layers

| Layer | Runner | Where |
|---|---|---|
| Domain unit/property | Node + fast-check + in-memory Automerge | `packages/domain/src/*.test.ts` |
| Worker / DO / D1 | `@cloudflare/vitest-pool-workers` (real workerd) | `apps/worker/src/**/*.test.ts` |
| Component + a11y | jsdom + Testing Library + vitest-axe | `apps/web/src/**/*.test.tsx` |
| E2E (multi-user) | Playwright (chromium-desktop / mobile-chrome / mobile-safari) | `apps/web/e2e/*.spec.ts` |

## Coverage table (every US-001…US-054)

| US | Title | Primary layer(s) | Test file(s) |
|---|---|---|---|
| US-001 | ULID id generation | domain | `packages/domain/src/ids.test.ts` |
| US-002 | Dance metadata registry | domain | `packages/domain/src/dances.test.ts` |
| US-003 | ATTRIBUTE_REGISTRY + merge | domain | `packages/domain/src/vocabulary.test.ts` |
| US-004 | Float-count timing | domain | `packages/domain/src/timing.test.ts` |
| US-005 | Routine + figure doc schemas | domain | `packages/domain/src/doc-schemas.test.ts` |
| US-006 | Overlay resolution | domain | `packages/domain/src/overlay.test.ts` |
| US-007 | Choreo fork (clone) | domain | `packages/domain/src/fork.test.ts` |
| US-008 | Copy-on-write (auto-variant) | domain | `packages/domain/src/fork.test.ts` |
| US-009 | Automerge convergence invariants | domain (property) | `packages/domain/src/convergence.test.ts` |
| US-010 | History-based per-user undo | domain | `packages/domain/src/undo.test.ts` |
| US-011 | figureType annotation resolution | domain | `packages/domain/src/figuretype-notes.test.ts` |
| US-012 | Zod schemas (lenient read / strict write) | domain | `packages/domain/src/schemas.test.ts` |
| US-013 | Migration ladder (schemaVersion) | domain | `packages/domain/src/migrations.test.ts` |
| US-014 | SQLite-backed DO hosts an Automerge doc | worker | `apps/worker/src/doc-do.test.ts` |
| US-015 | Live WebSocket sync (two clients converge) | worker + E2E | `apps/worker/src/doc-do.test.ts`, `apps/web/e2e/convergence.spec.ts` |
| US-016 | DO alarm: compaction + D1 projection + invite expiry | worker | `apps/worker/src/doc-do.test.ts` |
| US-017 | store/ seam (multi-doc) | component (+ worker for sync) | `apps/web/src/store/routine-store.test.ts` |
| US-018 | Open & view a routine | component + E2E | `apps/web/src/components/assemble.test.tsx`, `apps/web/e2e/authoring.spec.ts` |
| US-019 | Clerk sign-in + onboarding | worker (+ existing negative `auth/index.test.ts`) | `apps/worker/src/routes/me-profile.test.ts` |
| US-020 | Per-document membership & roles | worker | `apps/worker/src/permissions.test.ts` |
| US-021 | Permission boundary at the DO connection | worker + E2E | `apps/worker/src/permissions.test.ts`, `apps/web/e2e/permission-quota-invite.spec.ts` |
| US-022 | Quota: 3 owned routines + upsell | worker + component + E2E | `apps/worker/src/routes/quota.test.ts`, `apps/web/src/components/choreo-list.test.tsx`, `apps/web/e2e/permission-quota-invite.spec.ts` |
| US-023 | Invite by link (issue + redeem) | worker + E2E | `apps/worker/src/routes/invite.test.ts`, `apps/web/e2e/permission-quota-invite.spec.ts` |
| US-024 | Share screen (member list + roles) | worker | `apps/worker/src/routes/share.test.ts` |
| US-025 | Create a routine | worker + E2E | `apps/worker/src/routes/quota.test.ts`, `apps/web/e2e/authoring.spec.ts` |
| US-026 | Add / rename / reorder / delete sections | component + E2E | `apps/web/src/components/assemble.test.tsx`, `apps/web/e2e/authoring.spec.ts` |
| US-027 | Add / reorder / delete placements | component + E2E | `apps/web/src/components/assemble.test.tsx`, `apps/web/e2e/authoring.spec.ts` |
| US-028 | Figure timeline: place/edit/remove attributes | component + E2E | `apps/web/src/components/attribute-editor.test.tsx`, `apps/web/e2e/authoring.spec.ts` |
| US-029 | Attribute editor (registry-derived) | component | `apps/web/src/components/attribute-editor.test.tsx` |
| US-030 | Timeline role-view toggle | component + E2E | `apps/web/src/components/attribute-editor.test.tsx`, `apps/web/e2e/authoring.spec.ts` |
| US-031 | Edit per-figure alignment | component | `apps/web/src/components/assemble.test.tsx` |
| US-032 | Global figure library browse | worker + component | `apps/worker/src/routes/search.test.ts`, `apps/web/src/components/figure-library.test.tsx` |
| US-033 | Account variants + custom figures | worker + component | `apps/worker/src/routes/search.test.ts`, `apps/web/src/components/figure-library.test.tsx` |
| US-034 | Editing your own figure flows everywhere | worker + E2E | `apps/worker/src/figures.test.ts`, `apps/web/e2e/fork-and-figures.spec.ts` |
| US-035 | Auto-variant on editing a non-owned figure | worker + component + E2E | `apps/worker/src/figures.test.ts`, `apps/web/src/components/figure-library.test.tsx`, `apps/web/e2e/fork-and-figures.spec.ts` |
| US-036 | Fork a figure into a variant explicitly | component | `apps/web/src/components/figure-library.test.tsx` |
| US-037 | Choreo fork ("make it your own") | component + E2E | `apps/web/src/components/choreo-list.test.tsx`, `apps/web/e2e/fork-and-figures.spec.ts` |
| US-038 | Per-user undo / redo UX | component + E2E | `apps/web/src/components/profile.test.tsx`, `apps/web/e2e/undo.spec.ts` |
| US-039 | Unified annotations: point + figure | component | `apps/web/src/components/annotations.test.tsx` |
| US-040 | figureType annotations (this/all dances) | component + E2E | `apps/web/src/components/annotations.test.tsx`, `apps/web/e2e/fork-and-figures.spec.ts` |
| US-041 | Co-member visibility of family notes (option 2) | worker + E2E | `apps/worker/src/figuretype-visibility.test.ts`, `apps/web/e2e/fork-and-figures.spec.ts` |
| US-042 | Annotation filters | component | `apps/web/src/components/annotations.test.tsx` |
| US-043 | Custom attribute-kind creation UI | component | `apps/web/src/components/custom-kind.test.tsx` |
| US-044 | Lanes (one kind across all counts) | component | `apps/web/src/components/attribute-editor.test.tsx` |
| US-045 | Sample routine + start-from-template | component | `apps/web/src/components/choreo-list.test.tsx` |
| US-046 | Routine + figure search (EXPLAIN) | worker | `apps/worker/src/routes/search.test.ts` |
| US-047 | JSON export (routine + figures) | worker + E2E | `apps/worker/src/routes/export-import.test.ts`, `apps/web/e2e/export-import.spec.ts` |
| US-048 | JSON import (routine + figures) | worker + E2E | `apps/worker/src/routes/export-import.test.ts`, `apps/web/e2e/export-import.spec.ts` |
| US-049 | Ops: Sentry + AE + EXPLAIN gate + Smart Placement | worker | `apps/worker/src/ops.test.ts` |
| US-050 | PWA install + offline app shell | E2E | `apps/web/e2e/pwa-a11y.spec.ts` |
| US-051 | Accessibility WCAG AA | component (axe) + E2E | `apps/web/src/components/a11y.test.tsx`, `apps/web/e2e/pwa-a11y.spec.ts` |
| US-052 | Cross-browser E2E | E2E (3 projects) | the whole `apps/web/e2e/` matrix (chromium-desktop / mobile-chrome / mobile-safari) |
| US-053 | Account / profile + plan status | worker + component | `apps/worker/src/routes/me-profile.test.ts`, `apps/web/src/components/profile.test.tsx` |
| US-054 | Full Standard syllabus library seed (ISTD) | domain | `packages/domain/src/seed-library.test.ts` |

**Every US-001…US-054 is covered.** No story is left untested.

## Reusable test abstractions built (signatures + locations)

### Domain (`packages/domain/src/__fixtures__/`)
- `factories.ts` — pure POJO builders: `makeAttribute`, `makeAlignment`,
  `makeOverlay`, `makeFigureDoc`, `makeVariantDoc(base, byUser)`, `makePlacement`,
  `makeSection`, `makeAnnotation`, `makeAnchor`, `makeFigureTypeAnchor`,
  `makeRoutineDoc`, `pointAnchor`, `testId`/`resetTestIds`.
- `sample.ts` — the read-only **SAMPLE routine** + shared **figure library** incl.
  a **variant**: `SAMPLE_ROUTINE`, `SAMPLE_WALTZ_ROUTINE`, `FEATHER_FOXTROT`,
  `FEATHER_WALTZ` (cross-dance family), `THREE_STEP_FOXTROT`,
  `STUDENT_FEATHER_VARIANT`, `SAMPLE_FIGURE_LIBRARY`, ids `SAMPLE_COACH/STUDENT/STRANGER`.
- `convergence.ts` — fast-check Automerge helper: `loadAutomerge()` (lazy),
  `applyMutations`, `exchangeAndAssertConverged`, `assertCommutative`,
  `assertIdempotent`, `assertBytesEqual`.
- `domain-api.ts` — `importDomain(): Promise<DomainApi>` typed shim = the M1
  domain export contract.
- `types.ts` — test-owned structural document-graph types.

### Worker (`apps/worker/src/test-support/`)
- `seed.ts` — `applyMigrations()` (calls `applyD1Migrations(env.DB,
  env.TEST_MIGRATIONS)`), `seedDb(spec)` (users/docs/memberships/invites into the
  §2.7 D1 tables), `roleFor(docRef, userId)`.
- `jwt.ts` — `generateTestKeypair()` (RSA-256 via Web Crypto; exports SPKI PEM for
  `CLERK_JWT_KEY`), `makeTestJWT(keypair, claims)`, `makeExpiredJWT`.
- `authed-context.ts` — `authedContext({ keypair, userId, docRef, role })` → token
  + membership row + `authHeaders()`; `role: null` models a forged/non-member.
- `do-id.ts` — `uniqueDocName(prefix)` / `uniqueDocStub(ns)` (MANDATORY unique DO
  ids — `isolatedStorage:false`).
- `doc-do-api.ts` — structural `DocStub` / `DocNamespace` (the M2 DO RPC contract).
- `fixtures.ts` — the worker-side `SAMPLE_SEED` (coach owns / student co-member /
  stranger non-member) mirroring the domain sample.
- `explain.ts` — **`expectIndexedQuery(db, sql, params, opts)` body implemented**
  (runs `EXPLAIN QUERY PLAN`, fails on any un-allow-listed `SCAN`) +
  `expectIndexedDrizzle(db, query)`.
- `db-env.d.ts` — augments `cloudflare:test` ProvidedEnv with `DB` + `DOC_DO`.

### Web component (`apps/web/src/test-support/`)
- `render.tsx` — `renderUi(ui, { queryClient })` (wraps in QueryClientProvider),
  `makeTestQueryClient()`, `axeCheck(container)`, re-exports Testing Library +
  `userEvent`.
- `import-component.ts` — `importComponent<T>(specifier)` typed dynamic-import shim
  for not-yet-built screens.
- `axe-matchers.d.ts` — `toHaveNoViolations()` type augmentation for vitest 3
  (vitest-axe 0.1.0 augments the wrong interface).

### E2E (`apps/web/e2e/support/`)
- `two-users.ts` — `openUser`/`openTwoUsers`/`closeUsers` (two real browser
  contexts), `expectConverged(pages, locator, text)` and `expectAbsent` —
  **no sleeps**, polls observable state.
- `auth.ts` — `seedAuth(page, userId)` (deterministic E2E session),
  `gotoRoutine`, `E2E_SESSION_KEY`.

## Verification (run at authoring time — all GREEN)

- `pnpm test` → exit 0. Domain 49 skipped (13 files); worker 47 skipped + 3 pre-existing pass (13 files); web 52 skipped (9 files). No collection/import errors.
- `pnpm typecheck` → all 4 workspaces pass.
- `pnpm lint` → Biome clean (no errors).
- `pnpm --filter web exec playwright test --list` → 54 tests collect across 3 projects (18 × 3).

Per-AC splitting for gradual adoption: US-029 / US-030 / US-031 were split into one
`it` per acceptance criterion, and a US-009 AC-4 "convergence across a fork (cloned
doc)" property test was added. Each story in `USER-STORIES.md` now carries a
`Tests (unskip when done)` block naming the exact file(s) + test names to pass.
Inline gaps flagged there (none leave a US uncovered): US-024 AC-4 role microcopy
(Share component test when the screen lands); US-026 AC-3 section reorder/delete
two-client merge (extend the convergence E2E); US-037 AC-1 fork→quota count;
US-038 AC-3 superseded-hint UI.

## Missing dependencies (for devops — NOT installed by the test engineer)

1. **`@automerge/automerge`** is NOT declared as a dependency of `@ballroom/domain`
   (nor `apps/worker`). It exists in the pnpm store (from the removed M0.5 spike)
   but is not resolvable from either workspace. The domain convergence/undo
   property tests and the M1 doc builders need it. **Action (M1, §9 0.2):** add
   `@automerge/automerge` to `packages/domain` (and `apps/worker` for M2). Until
   then the convergence helper loads it via a deferred runtime specifier, so the
   skipped suite stays green; unskipping US-009/US-010 requires this dep.
2. **No JWT minting dep needed.** `makeTestJWT` is built on Web Crypto (RS256), so
   no `jose`/`jsonwebtoken` is required for v1. If a future test needs ES256/EdDSA
   or JWKS rotation, consider adding `jose` — not required now.

## Notes / wiring that lands with the product (not blockers)

- **`DOC_DO` Durable Object binding** is referenced by the worker DO/permission
  suites but is not yet in `apps/worker/wrangler.toml` (M0 task 0.3 mentioned it;
  it arrives with the M2 DO). Typed loosely via `db-env.d.ts`; used only inside
  skipped bodies.
- **D1 migrations** dir is empty until M2; `applyMigrations()` is a no-op for `[]`.
  `seedDb` inserts assume the §2.7 tables (`users`, `document_registry`,
  `membership`, `invite`, `figure_type_note_index`) — created by the M2/M6 Drizzle
  migrations.
- **Positive-path `/api/me`** and the E2E auth mode need the test PEM injected as
  `CLERK_JWT_KEY` (worker) and an E2E impersonation mode (web) — both M3 wiring;
  the helpers (`generateTestKeypair`, `seedAuth`) are ready.
- **US-017 architecture boundary** (components import only from `store/`) is marked
  as a placeholder assertion pending an M2 dependency-cruiser / lint rule.
