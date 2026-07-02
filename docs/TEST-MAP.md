# Test Map — feature/story key → test file × layer

> **Note (2026-07-02):** the `USER-STORIES.md` backlog was removed. The `US-…` ids
> below survive as **stable keys** (in test names, headers, and PLAN.md) — this map
> and each test's header comment are now their only definition. Roadmap/status
> live in `PLAN.md` §9.

**Status (updated 2026-06-28):** the TDD suite was authored ahead of the build as
fully `describe.skip` / `test.skip` (RED→GREEN→REFACTOR); **most of it has since
been unskipped and is executing green** as the product modules landed (M1–M7).
On `development` HEAD the suite runs — **domain 154 passed / 3 skipped, web 114
passed / 0 skipped, worker 101 passed / 7 skipped** — with only the
not-yet-built stories still skipped (US-049 Ops, US-053 `/api/profile`, US-054
ISTD seed, and the M9 PWA/all-dances-annotation E2E slices). Source of truth for
"what GREEN means" per story is each test's header comment (US-ID, intent,
multi-user scenario, arrange/act/assert, acceptance criteria + PLAN §10.2
invariant); the original "everything is skipped" framing below describes the
*authoring-time* baseline, not today's state.

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
| US-006 | ~~Overlay resolution~~ *(retired + removed 2026-06-30)* | — | `packages/domain/src/overlay.test.ts` **does not exist and was never created**. `resolve()` does not exist. The `Overlay` type, `overlay?` field on `FigureDoc`, and the overlay retag branch in `migrations.ts` are all deleted. Old docs carrying a stray `overlay` key are stripped by v2→v3 migration (proven in `migrations.test.ts`). *(Reconciled 2026-06)* |
| US-007 | Choreo fork (clone) | domain | `packages/domain/src/fork.test.ts` |
| US-008 | Copy-on-write (frozen choreo-owned copy) *(reconciled 2026-06: no overlay)* | domain | `packages/domain/src/fork.test.ts` |
| US-009 | Automerge convergence invariants | domain (property) | `packages/domain/src/convergence.test.ts` |
| US-010 | History-based per-user undo | domain | `packages/domain/src/undo.test.ts` |
| US-011 | figureType annotation resolution | domain | `packages/domain/src/figuretype-notes.test.ts` |
| US-012 | Zod schemas (lenient read / strict write) | domain | `packages/domain/src/schemas.test.ts` |
| US-013 | Migration ladder (schemaVersion) | domain | `packages/domain/src/migrations.test.ts` |
| US-014 | SQLite-backed DO hosts an Automerge doc | worker | `apps/worker/src/doc-do.test.ts` |
| US-015 | Live WebSocket sync (two clients converge) | worker + E2E | `apps/worker/src/doc-do.test.ts`, `apps/web/e2e/convergence.spec.ts` |
| US-016 | DO alarm: compaction + D1 projection + invite expiry | worker | `apps/worker/src/doc-do.test.ts` |
| US-017 | store/ seam (multi-doc — each figure carries own attrs; no overlay resolve) *(reconciled 2026-06)* | component (+ worker for sync) | `apps/web/src/store/routine-store.test.ts` |
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
| US-033 | Personal-library figures + custom figures (two-scope badge: `library`/`custom`) *(reconciled 2026-06: "account variants" retired)* | worker + component | `apps/worker/src/routes/search.test.ts`, `apps/web/src/components/figure-library.test.tsx` |
| US-034 | Editing your own figure flows everywhere | worker + E2E | `apps/worker/src/figures.test.ts`, `apps/web/e2e/fork-and-figures.spec.ts` |
| US-035 | Auto-copy (frozen choreo-owned copy, "copied into this choreo" toast) *(reconciled 2026-06: "auto-variant"/"copied as your variant" retired)* | worker + component + E2E | `apps/worker/src/figures.test.ts`, `apps/web/src/components/figure-library.test.tsx`, `apps/web/e2e/fork-and-figures.spec.ts`; also `figures.test.ts` covers `POST /api/figures/save-to-library` (migration 0010, the explicit reuse path). |
| US-036 | ~~Fork a figure into a live-overlay variant~~ *(reconciled 2026-06: RETIRED — subsumed by US-035 + save-to-library)* | — | No test file; no overlay variant model. Subsumed by US-035 (auto-copy) + `POST /api/figures/save-to-library` (explicit reuse, `figures.test.ts`, migration 0010). |
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
| US-047 | _retired — JSON export superseded by forking_ | — | — |
| US-048 | _retired — JSON import superseded by forking_ | — | — |
| US-049 | Ops: Sentry + AE + EXPLAIN gate + Smart Placement | worker | `apps/worker/src/ops.test.ts` |
| US-050 | PWA install + offline app shell | E2E | `apps/web/e2e/pwa-a11y.spec.ts` |
| US-051 | Accessibility WCAG AA | component (axe) + E2E | `apps/web/src/components/a11y.test.tsx`, `apps/web/e2e/pwa-a11y.spec.ts` |
| US-052 | Cross-browser E2E | E2E (3 projects) | the whole `apps/web/e2e/` matrix (chromium-desktop / mobile-chrome / mobile-safari) |
| US-053 | Account / profile + plan status | worker + component | `apps/worker/src/routes/me-profile.test.ts`, `apps/web/src/components/profile.test.tsx` |
| US-054 | Full Standard syllabus library seed (ISTD) | domain | `packages/domain/src/seed-library.test.ts` |

**Every live story (US-001…US-054, minus the retired US-047/US-048) is covered.** No story is left untested.

## Reusable test abstractions built (signatures + locations)

### Domain (`packages/domain/src/__fixtures__/`)
- `factories.ts` — pure POJO builders: `makeAttribute`, `makeAlignment`,
  `makeFigureDoc`, `makeVariantDoc(base, byUser)`, `makePlacement`,
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

## Verification

**Authoring-time baseline (all GREEN, fully skipped):** `pnpm test` → exit 0 with
Domain 49 skipped (13 files), worker 47 skipped + 3 pre-existing pass (13 files),
web 52 skipped (9 files); typecheck + lint clean; `playwright test --list` → 51
tests across 3 projects.

**Current (`development` HEAD, 2026-06-28):** the suite executes for real —
- `pnpm --filter @ballroom/domain test` → **154 passed, 3 skipped** (only US-054 ISTD seed).
- `pnpm --filter web test` → **114 passed, 0 skipped**.
- `pnpm --filter worker test` → **101 passed, 7 skipped** (US-049 ops ×5, US-053 `/api/profile` ×2); worker `coverage` meets its armed thresholds (lines 89.5 / branches 69.2 / fns 87.9 / stmts 85.4).
- `pnpm -r typecheck` → 4 workspaces pass; `pnpm lint` → Biome clean (226 files).
- E2E: `@smoke` Playwright runs as the CI gate (per-PR `ci.yml` + on-push `deploy.yml`); the full 3-device matrix runs nightly. Still `test.skip`: `pwa-a11y.spec` (M9) and the all-dances family-note slice at `fork-and-figures.spec:208`.

Per-AC splitting for gradual adoption: US-029 / US-030 / US-031 were split into one
`it` per acceptance criterion, and a US-009 AC-4 "convergence across a fork (cloned
doc)" property test was added. Inline
gaps flagged (none leave a US-key uncovered): US-024 AC-4 role microcopy
(Share component test when the screen lands); US-037 AC-1 fork→quota count.

**Gaps RESOLVED in this program (reconciled 2026-06):**
- **US-026 AC-3** cross-section reorder/soft-delete convergence test — **SHIPPED**: the
  two-client section reorder + soft-delete convergence assertion is now part of
  `apps/web/e2e/convergence.spec.ts`.
- **US-038 AC-3** soft "superseded" hint — **SHIPPED**: `wasSupersededByOthers(doc,
  actorId)` in `packages/domain/src/undo.ts` + store seam + `Assemble.tsx` toast
  variant. See PLAN.md §5.4 for the full spec.

**New surfaces shipped in the design-parity program (reconciled 2026-06):**
- **Journal tab** (US-039/040/041/042 cross-routine view): `apps/web/e2e/journal.spec.ts`
  (`@smoke`); `GET /api/journal` UNIONs `journal_entry` D1 index + `FigureTypeNoteIndex`
  account rows; DO alarm projects lesson/practice annotations to `journal_entry`.
- **Save-to-library** (`POST /api/figures/save-to-library`, migration 0010): covered by
  `apps/worker/src/figures.test.ts`; idempotent on `(owner, baseFigureRef)`, auth-gated,
  server-resolves catalog figure from bundled reference data. See PLAN.md §4.2 + §5.2.
- **Tango-Rise write gate** (`dance_not_applicable`): the DO seed route + store seam reject
  a `rise` attribute on a Tango figure with a `dance_not_applicable` error; vocabulary
  `appliesToDances` enforced on the write path. Covered in `vocabulary.test.ts` /
  `figures.test.ts`.
- **US-038 AC-3 undo superseded hint**: see above under "Gaps RESOLVED".

## Missing dependencies (for devops — NOT installed by the test engineer)

1. **`@automerge/automerge`** — **RESOLVED (US-005, development HEAD):** `@automerge/automerge`
   is now declared in `packages/domain` (US-005). The domain convergence/undo property tests
   (US-009/US-010) and M1 doc builders now resolve it. The deferred-specifier workaround in
   the convergence helper is no longer needed for new tests. Worker M2 dep also present.
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
