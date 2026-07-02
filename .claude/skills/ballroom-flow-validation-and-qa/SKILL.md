---
name: ballroom-flow-validation-and-qa
description: Load when writing or modifying ANY test in ballroom-flow, deciding which test layer(s) a change needs, judging whether a feature is "done", touching fixtures/harness helpers, or reasoning about coverage thresholds and TEST-MAP.md. Keywords - vitest, Playwright, @smoke, TDD, unskip, DO id, applyD1Migrations, expectIndexedQuery, convergence test, coverage ratchet.
---

# Ballroom Flow — validation & QA runbook

How to prove a change is correct in this repo: what "done" means, which test layer owns what,
the harness conventions that break the suite if ignored, per-layer recipes, and coverage rules.

**When NOT to use this:**
- A test is *failing* and you're diagnosing it → `ballroom-flow-debugging-playbook`.
- Automerge/CRDT semantics (clone-before-reuse, undefined, heads-vs-bytes) in depth → `ballroom-flow-crdt-reference` (this skill only states the test-facing rules).
- Toolchain, sandbox setup, Playwright browser install traps, CI/env wiring → `ballroom-flow-build-and-env` and `ballroom-flow-diagnostics-and-tooling`.
- Branching, PR flow, keeping PLAN.md in sync → `ballroom-flow-change-control`.
- Why past incidents shaped these rules (full history) → `ballroom-flow-failure-archaeology`.

---

## 1. The evidence bar: what "done" means

**Delivery model (adopted 2026-06-26, CLAUDE.md §6):** every remaining feature ships as an
**end-to-end-testable feature, gated on its Playwright journey** (`apps/web/e2e/*.spec.ts`).

- A feature is **done ONLY when its E2E journey is green on the PR**. Unit + component tests
  alone are **insufficient** for a feature — the M1–M3 stack shipped fully unit-tested with
  **zero verified browser journeys**, and that gap is exactly what forced this rule.
- `@smoke`-tagged journeys run on **every PR** (`ci.yml`: `playwright test
  --project=chromium-desktop --grep @smoke`); the **full 3-device matrix runs nightly**
  (`nightly.yml`, cron `0 5 * * *`, chromium + webkit).
- Lower layers are still mandatory — they localize failures and carry the coverage gates —
  but they are *supporting evidence*, not the ship gate.

Evidence checklist for a change (run before calling anything done):

```bash
pnpm lint && pnpm typecheck        # Biome (noExplicitAny=error) + tsc, all 4 workspaces
pnpm test                          # domain + contract + worker/DO + web component (~1 min)
pnpm test:e2e:smoke                # @smoke Playwright subset (locally add --project=chromium-desktop)
```

For a *feature*, additionally: its named journey spec exists (or was extended), is `@smoke`-tagged
if it belongs in the PR gate, and passes.

## 2. Layer ownership

| Layer | Runner | What it proves | Files | Run |
|---|---|---|---|---|
| Domain unit/property | vitest, Node, in-memory Automerge + fast-check | Doc schemas, fork/variant resolution (`resolveFigure` per-beat ownership), CRDT convergence/commutativity/idempotence, per-user undo, registry/Zod, timing, migration ladder | `packages/domain/src/*.test.ts` | `pnpm --filter @ballroom/domain test` |
| Worker / DO / D1 | `@cloudflare/vitest-pool-workers` in **real workerd** | Per-doc Durable Object sync + SQLite persistence, permission boundary at the connection, quota, invites, alarm compaction/projection, every D1 query indexed | `apps/worker/src/**/*.test.ts` | `pnpm --filter worker test` |
| Component + a11y | vitest + jsdom + Testing Library + vitest-axe | Screens render registry-driven UI, role gating, toasts, axe/WCAG assertions | `apps/web/src/**/*.test.tsx` | `pnpm --filter web test` |
| Contract | vitest (types + Zod) | Shared API shapes; drift fails `tsc` | `packages/contract/src/*.test.ts` | `pnpm --filter @ballroom/contract test` |
| E2E journeys | Playwright, 3 projects (`chromium-desktop`, `mobile-chrome`, `mobile-safari`) | Real browsers against real workerd: authoring, two-client convergence, fork independence, permissions/quota/invite, undo, PWA/a11y | `apps/web/e2e/*.spec.ts` | `pnpm test:e2e` (all) / `pnpm test:e2e:smoke` |

Push correctness **down** the pyramid (PLAN.md §10.1): CRDT/fork/undo logic is proven exhaustively
in `domain`; the worker layer proves the boundary; E2E proves the journey, not the algebra.

### Fixture/helper inventory (use these — do not reinvent)

**Domain — `packages/domain/src/__fixtures__/`** (import from `./__fixtures__`):

| Helper | Provides |
|---|---|
| `factories.ts` | Pure POJO builders: `makeAttribute`, `makeAlignment`, `makeFigureDoc`, `makeVariantDoc(base, byUser)`, `makePlacement`, `makeSection`, `makeAnnotation`, `makeAnchor`, `makeFigureTypeAnchor`, `makeRoutineDoc`, `pointAnchor`, `testId`/`resetTestIds` |
| `sample.ts` | Frozen shared world: `SAMPLE_ROUTINE`, `SAMPLE_WALTZ_ROUTINE`, `FEATHER_FOXTROT`, `FEATHER_WALTZ`, `THREE_STEP_FOXTROT`, `STUDENT_FEATHER_VARIANT`, `SAMPLE_FIGURE_LIBRARY`, ids `SAMPLE_COACH`/`SAMPLE_STUDENT`/`SAMPLE_STRANGER` |
| `convergence.ts` | `loadAutomerge()` (lazy), `applyMutations`, `exchangeAndAssertConverged`, `assertCommutative`, `assertIdempotent`, `assertHeadsEqual`, `assertBytesEqual` (single-doc round-trip ONLY — never compare save() bytes across merge orders) |
| `domain-api.ts` | `importDomain(): Promise<DomainApi>` — the typed dynamic-import shim (§4 below) |

**Worker — `apps/worker/src/test-support/`:**

| Helper | Provides |
|---|---|
| `seed.ts` | `applyMigrations()` (runs the `TEST_MIGRATIONS` SQL **directly** against the shared D1 — idempotent, deliberately NOT via `applyD1Migrations`, see §3.2), `seedDb(spec)` (users/docs/memberships/invites/family-note index rows — D1 index only, never CRDT content), `roleFor` |
| `jwt.ts` | `generateTestKeypair()` (returns the fixed test keypair matching the statically-bound `CLERK_JWT_KEY` PEM), `makeTestJWT`, `makeExpiredJWT` |
| `authed-context.ts` | `authedContext({ keypair, userId, docRef, role })` → seeded user + membership + signed JWT + `authHeaders()`; `role: null` models a forged/non-member connection |
| `do-id.ts` | `uniqueDocName(prefix)`, `uniqueDocStub(env.DOC_DO, prefix)` — **mandatory** (§3.1) |
| `doc-do-api.ts` | Structural `DocStub`/`DocNamespace` types for the DO RPC surface |
| `fixtures.ts` | `SAMPLE_SEED` (coach owns / student co-member / stranger non-member), mirrors the domain sample |
| `explain.ts` | `expectIndexedQuery(db, sql, params?, opts?)` + `expectIndexedDrizzle(db, query)` — the no-SCAN gate (§3.6) |
| `test-keys.ts` | `TEST_JWT_PUBLIC_KEY_PEM` (bound in `apps/worker/vitest.config.ts`) |

**Web component — `apps/web/src/test-support/`:**

| Helper | Provides |
|---|---|
| `render.tsx` | `renderUi(ui, { queryClient? })` (wraps QueryClientProvider + ToastProvider + NullAuthProvider), `makeTestQueryClient()`, `axeCheck(container)`, re-exports Testing Library + `userEvent` |
| `import-component.ts` | `importComponent<T>(specifier)` — typed dynamic-import shim for not-yet-built screens |
| `axe-matchers.d.ts` | `toHaveNoViolations()` type augmentation for vitest 3 |

**E2E — `apps/web/e2e/support/`:**

| Helper | Provides |
|---|---|
| `auth.ts` | `seedAuth(page, userId)` (deterministic session — no real Clerk in E2E), `stagePendingAuth`, `gotoRoutine`, `E2E_SESSION_KEY` |
| `fixtures.ts` | `resetDb(page)`, `seedDb(page, spec)` — hit the worker's `/api/test/*` routes (enabled only when `E2E_TEST_ROUTES="1"`, i.e. the `[env.e2e]` wrangler env) |
| `two-users.ts` | `openUser`/`openTwoUsers`/`closeUsers` (two real browser contexts), `expectConverged(pages, locator, text)`, `expectAbsent` — poll observable DOM, **no sleeps** |
| `jwt.ts` | E2E token minting against the committed test PEM |

## 3. Harness conventions that bite (each with WHY)

1. **Unique DO id per worker test — MANDATORY.** `apps/worker/vitest.config.ts` sets
   `isolatedStorage: false` because SQLite-backed Durable Objects break vitest-pool-workers'
   isolated-storage teardown (it chokes on the `-shm`/`-wal` sidecars — M0.5 spike finding,
   `docs/spike/SPIKE-FINDINGS.md`). Storage is therefore **NOT reset between tests**: a reused
   DO name silently inherits the previous test's document. Always derive ids via
   `uniqueDocName("routine")` / `uniqueDocStub(env.DOC_DO, "figure")` from
   `test-support/do-id.ts`. Never hard-code a DO name.
2. **Every suite must call `applyMigrations()` in `beforeAll` (shared D1, idempotent
   re-migration).** The vitest config reads `apps/worker/migrations/` (13 migration files)
   at config time and exposes them as the `TEST_MIGRATIONS` miniflare binding. D1 is **one
   shared database for the whole worker run** (`isolatedStorage: false`), so
   `applyMigrations()` (`test-support/seed.ts`) runs the migration SQL **directly**
   (`env.DB.prepare(query).run()`, swallowing only the "duplicate column name" re-add) —
   deliberately NOT via `applyD1Migrations`, whose `d1_migrations` bookkeeping raced under
   shared storage and made suites skip their CREATEs ("no such table" flakes; fixed
   `79b927d`, internal #173/#203 — do not reintroduce it; see
   `ballroom-flow-debugging-playbook` §9). Without the call your suite queries missing
   tables. Then seed with `seedDb(...)`.
3. **Never top-level-import a not-yet-built product export.** A top-level `import { thing }`
   throws at module *load*, breaking collection for the whole file **even when every test is
   skipped**. Use `import type` (erased at compile time) or a dynamic `await import(...)`
   *inside* the test body. The blessed shims: `importDomain()` (domain), the structural
   `DocStub`/`DocNamespace` types + `SELF.fetch` (worker), `importComponent<T>()` (web).
4. **No sleeps — determinism by construction** (PLAN.md §10.3: "No sleeps; deterministic
   auth+seed; convergence asserted by exchanging changes; `retries:1` + trace"). Domain
   convergence is asserted by *exchanging changes* and comparing sorted heads
   (`exchangeAndAssertConverged`), never by waiting. E2E uses Playwright auto-retrying
   assertions on observable DOM (`expectConverged`). Auth is seeded (`seedAuth`,
   `authedContext`), never a real sign-in flow. A `page.waitForTimeout`/`setTimeout` in a test
   is a review-blocking smell.
5. **E2E is serialized on one shared D1.** `apps/web/playwright.config.ts`: `workers: 1`,
   `fullyParallel: false` — specs `resetDb` + `seedDb` a single local D1
   (`e2e/serve.sh` boots one `wrangler dev --env e2e` origin). Do not parallelize, and do not
   write a spec that assumes leftover state from another spec.
6. **EXPLAIN no-SCAN gate for every new D1 query.** NFR: D1 bills by rows *scanned*; every
   list/search/registry/membership/quota query must hit an index. When you add or change a D1
   query, add an `expectIndexedQuery(env.DB, sql, params)` assertion (or
   `expectIndexedDrizzle(env.DB, drizzleQuery)` — it calls `.toSQL()` for you). It runs
   `EXPLAIN QUERY PLAN` and fails on any un-allowlisted `SCAN`. If it fails, add an index
   migration — don't allowlist your way past it (the `allow` opt-out is for tiny reference
   tables only).
7. **Automerge test-facing rules** (details in `ballroom-flow-crdt-reference`): docs can't
   store `undefined` (builders use `stripUndefined`; `null` is meaningful — `deletedAt: null`);
   `A.clone(base)` before reusing a doc after change/merge ("outdated document" RangeError
   otherwise); assert convergence via sorted `getHeads`, **never** by comparing `save()` bytes
   across merge orders (`assertBytesEqual` is for single-doc round-trips only).

These are also documented in `docs/DEVELOPMENT.md` ("Conventions the test engineer must know").

## 4. Recipes: adding a test at each layer

Every test in this repo carries a header comment: US-key(s), intent, scenario,
arrange/act/assert, and the PLAN §10.2 invariant it pins. Keep that convention.

### Domain (model: `packages/domain/src/fork.test.ts`)

```ts
import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";
import { FEATHER_FOXTROT, importDomain, makePlacement, SAMPLE_ROUTINE, SAMPLE_STUDENT } from "./__fixtures__";

describe("US-0xx my invariant", () => {
  it("does the thing", async () => {
    const { buildRoutineDoc, cloneRoutine, readRoutine } = await importDomain();
    const origin = buildRoutineDoc(SAMPLE_ROUTINE);
    const fork = cloneRoutine(origin, { byUser: SAMPLE_STUDENT });
    expect(readRoutine(fork).forkedFromRef).toBe(SAMPLE_ROUTINE.id);
  });
});
```

Convergence properties: use fast-check + `exchangeAndAssertConverged`/`assertCommutative`
from `__fixtures__/convergence.ts` (model: `convergence.test.ts`).

### Worker / DO / D1 (model: `apps/worker/src/permissions.test.ts`)

```ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "./test-support/authed-context";
import { uniqueDocName } from "./test-support/do-id";
import type { DocNamespace } from "./test-support/doc-do-api";
import { expectIndexedQuery } from "./test-support/explain";
import { generateTestKeypair, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

const docs = env.DOC_DO as unknown as DocNamespace;
let kp: TestKeypair;

beforeAll(async () => {
  await applyMigrations();               // idempotent re-migration of the shared D1 (§3.2)
  kp = await generateTestKeypair();      // matches the statically-bound CLERK_JWT_KEY
});

it("rejects a non-member connection", async () => {
  const docName = uniqueDocName("routine");                 // NEVER a shared/fixed name
  await seedDb({ /* users/docs/memberships */ });
  const ctx = await authedContext({ keypair: kp, userId: "user_x", docRef: docName, role: null });
  // stub.fetch(new Request(..., { headers: { Upgrade: "websocket", "x-doc-name": docName, ...ctx.authHeaders() } }))
});
```

HTTP routes: `SELF.fetch("https://worker/api/...", { headers: ctx.authHeaders() })`. Route
suites live in `apps/worker/src/routes/*.test.ts` (model: `routes/quota.test.ts`).
New D1 query → add its `expectIndexedQuery` assertion in the same PR.

### Component + a11y (model: `apps/web/src/components/attribute-editor.test.tsx`)

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderUi, screen, userEvent } from "../test-support/render";
// Existing components: direct import. NOT-yet-built ones: importComponent<T>("../components/Foo")
// inside the (skipped) test body — see §3.3.

it("renders from the registry", async () => {
  renderUi(<AttributeEditor {...props} />);
  await userEvent.click(screen.getByRole("button", { name: /HT/i }));
  expect(onChange).toHaveBeenCalled();
});
```

A11y: sweep new screens with `axeCheck(container)` (pattern: `components/a11y.test.tsx`).
Components render from the store seam — mock at the `store/` boundary, never at Automerge/RPC.

### E2E journey (model: `apps/web/e2e/convergence.spec.ts`)

```ts
import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";
import { closeUsers, expectConverged, openTwoUsers } from "./support/two-users";

test.describe("@smoke my feature journey", () => {
  test("user-visible outcome", async ({ browser }) => {
    const [coach, student] = await openTwoUsers(browser, "user_coach", "user_student");
    await resetDb(coach.page);
    await seedDb(coach.page, { users: [/* … */] });
    // drive real UI via role/label locators; assert with auto-retrying expect / expectConverged
  });
});
```

Tag the one representative journey per feature `@smoke` (it becomes the PR gate); leave
exhaustive variants untagged (nightly). Single-user specs: `seedAuth(page, userId)` then
navigate. Locally run `pnpm --filter web exec playwright test --project=chromium-desktop`
(webkit is nightly/CI; see `ballroom-flow-build-and-env` for sandbox browser traps).

## 5. TDD discipline

- **RED→GREEN→REFACTOR, always.** Write (or unskip) the failing test first, watch it fail
  *for the expected reason*, implement, refactor. Don't write implementation before a failing
  test exists (CLAUDE.md §4).
- **Unskip-first for backlog items.** The backlog was authored as skipped tests
  (`describe.skip`/`test.skip` with US-key headers). Implementing a story = unskip its tests →
  RED → build → GREEN. Still skipped as of 2026-07-02: `apps/worker/src/ops.test.ts` (US-049,
  ×5), `apps/worker/src/routes/me-profile.test.ts` (US-053, ×2),
  `packages/domain/src/seed-library.test.ts` (US-054, ×3), `apps/web/e2e/pwa-a11y.spec.ts`
  (M9) and the all-dances slice at `apps/web/e2e/fork-and-figures.spec.ts:229`.
- **Never weaken, delete, or skip a test to make CI pass.** Root-cause instead. The repo's
  flake discipline is *de-flake by diagnosis*: b419e0a / ad22e16 (PRs #108/#110) fixed a11y
  flakes by identifying the real cause (axe sweeps timing out under parallel CI load /
  full-catalog render) rather than skipping; 1563bae hardened a cross-DO fork test against CI
  cold-start the same way. If a test is genuinely wrong, fix the test *and* say why in the PR.
- **Audit skip reasons — they go stale.** Lesson from d49fb52: `convergence.spec.ts` sat
  skipped with a "not built yet" reason while the machinery it tested had existed since M2 —
  the flagship two-client convergence journey was unverified for a whole milestone. When you
  touch an area, check whether its skipped tests can now run.
- **Keep the suite collectable.** Skipped tests must still parse and typecheck (§3.3). `pnpm
  test` must stay green on every commit — lefthook runs Biome + typecheck pre-commit; CI is
  the source of truth.

## 6. Coverage: armed thresholds and the ratchet

**This section is the single home for the coverage numbers** — sibling skills
(`ballroom-flow-build-and-env` §2, `ballroom-flow-diagnostics-and-tooling` §2.2) point here.
Thresholds are **armed** (a drop fails CI). Verified in the vitest configs as of 2026-07-02:

| Suite | lines | functions | branches | statements | Config |
|---|---|---|---|---|---|
| domain | 90 | 90 | 65 | 90 | `packages/domain/vitest.config.ts` (thresholds block) |
| worker | 88 | 85 | 66 | 84 | `apps/worker/vitest.config.ts` (thresholds block) |
| web | — (no thresholds armed) | | | | `apps/web/vitest.config.ts` |

Actuals from `pnpm coverage` on `development` HEAD `70eed7e`, 2026-07-02
(istanbul columns: %Stmts / %Branch / %Funcs / %Lines):

- domain **91.69 / 77.28 / 93.65 / 94.12** — 227 passed, 3 skipped
- worker **86.04 / 71.21 / 89.15 / 89.63** — 150 passed, 7 skipped
- web **71.09 / 68.32 / 65.52 / 73.80** — 331 passed

(Counts at the later same-day HEAD `3693ff6`, after PRs #133/#134/#135: domain 232/3 skipped,
web 333, worker 161 passed + **1 deterministic failure** (`fork.test.ts` "is independent of
the origin" — the known migrateOnLoad incident, fix pending as PR #140; 162/7 skipped once it
lands) — see **ballroom-flow-v5-migration-campaign** §2. A red `development` tip is that
incident, not license to weaken the test.)

**Ratchet plan (PLAN.md §10.3 + the config comments):** thresholds sit at the *measured floor*
so coverage can't silently regress; ratchet them **up** as the v5 milestone lands — domain
toward **95** (lines), worker toward **90**. When your change raises actuals meaningfully, bump
the thresholds in the same PR. Never lower a threshold to merge; if coverage drops, cover the
new branches. (Worker's all-files number is dragged by `routes/test-seed.ts`, the E2E-only
fixture route exercised by Playwright, not vitest — a constant drag, not a regression.)
Note: older doc text claiming thresholds are "commented out" (CLAUDE.md's "uncomment when
suites land") is stale — they are armed. CLAUDE.md's "domain ≥95%, worker ≥90%" figures are
NOT stale, though: they are exactly the PLAN §10.3 ratchet **targets** above, not the armed
floors. The configs are ground truth for what CI enforces today.

## 7. TEST-MAP.md maintenance

`docs/TEST-MAP.md` is the feature-key → test-file × layer matrix.

- **US-ids are stable keys**, not a live backlog: `USER-STORIES.md` was removed 2026-07-02;
  a US-id's only remaining definition is this map + each test's header comment. Never renumber
  or reuse one; retired stories stay listed as retired (e.g. US-006, US-036, US-047/048).
- **When you add coverage** (new test file, new layer for an existing story, a new
  feature/journey): update the map's coverage table in the **same PR**, and reference the
  US-key (or feature slug) in the test's header comment and, for stories, the test name.
- **Its "Verification" test counts are stale** (last reconciled 2026-06-28: says domain
  154 / web 114 / worker 101; actual on 2026-07-02 at HEAD `3693ff6`: 232 / 333 / 162-target
  — see §6). Trust `pnpm test`
  output over the map's counts; treat the map as authoritative for *which file covers which
  story*, not for totals. If you're editing the map anyway, refreshing the counts is welcome
  but keep it date-stamped.

## Provenance and maintenance

Written 2026-07-02 against repo HEAD `70eed7e`; test counts refreshed same day against HEAD
`3693ff6` (post-#133/#134/#135; PR #140 — which turns the worker suite green again — not yet
merged at refresh) on `development`. Verified directly against:
`packages/domain/vitest.config.ts`, `apps/worker/vitest.config.ts`, `apps/web/vitest.config.ts`,
`apps/web/playwright.config.ts`, `.github/workflows/{ci,nightly}.yml`, `docs/PLAN.md` §9/§10,
`docs/TEST-MAP.md`, `docs/DEVELOPMENT.md`, CLAUDE.md, the fixture/helper sources listed in §2,
model tests (`fork.test.ts`, `permissions.test.ts`, `attribute-editor.test.tsx`,
`convergence.spec.ts`), a fresh `pnpm coverage` run, and `git show d49fb52 / b419e0a / 1563bae`.

Re-verify volatile facts before relying on them:

```bash
grep -n "thresholds" -A5 packages/domain/vitest.config.ts apps/worker/vitest.config.ts  # armed numbers
pnpm coverage 2>&1 | grep -E "All files|passed"                                         # actuals + counts
grep -rn "describe.skip\|test.skip\|it.skip" packages/domain/src apps/worker/src apps/web/src apps/web/e2e  # remaining backlog skips
grep -n "grep @smoke" .github/workflows/ci.yml                                          # PR gate still smoke-only
pnpm --filter web exec playwright test --list | tail -1                                 # journey inventory
```
