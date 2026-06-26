# CLAUDE.md — working guide for Ballroom Flow

This file orients any contributor (human or agent) and routes you to the right document
for your task. **It does not duplicate those docs — it points to them.** Read the ones
relevant to your task before writing code.

Ballroom Flow is a collaborative, mobile-first **PWA for building and annotating ballroom
choreography**, built on an **Automerge CRDT document graph** on Cloudflare. See
[`README.md`](README.md) for the goal in one screen.

**Guiding principle:** *quality and maintainability over feature count* — YAGNI everywhere
**except** the deliberate fork / document-graph investment, which is the v1 centerpiece.

---

## 1. Source of truth & document map

| Document | What it is | Read it when… |
|---|---|---|
| **[`docs/PLAN.md`](docs/PLAN.md)** | **The single source of truth.** Domain model, controlled vocabularies, features-by-screen, collaboration/fork/permissions/undo, architecture, NFRs, **locked technical decisions** (§8), milestone roadmap (§9), testing strategy (§10). | **Always, first.** Any ambiguity is resolved here. |
| [`docs/USER-STORIES.md`](docs/USER-STORIES.md) | The v1 backlog: 52 stories (US-001…054, minus the retired US-047/048 JSON export/import — forking supersedes) mapped to milestones M1–M9. Each story has acceptance criteria, dependencies, **and an "unskip when done" block naming the exact tests that should pass when it's implemented.** | Picking up a unit of work; knowing what "done" means. |
| [`docs/TEST-MAP.md`](docs/TEST-MAP.md) | Story → test-file × layer coverage matrix; flagged sub-AC gaps. | Finding which tests cover a story, or what's not yet asserted. |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | How to install, run locally, run each test layer, manage env/secrets, and **the test-harness conventions you must follow**. | Setting up; running things; writing tests. |
| [`docs/TOOLING.md`](docs/TOOLING.md) | What dev/test tooling exists, why, and what's deferred (Sentry/Analytics → M8, Lighthouse → M9). | Touching CI, configs, or test infra. |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Token reference, primitive component inventory (`apps/web/src/ui`), responsive/a11y conventions, how to add a component. | Building any UI. |
| [`docs/design/DESIGN-PRINCIPLES.md`](docs/design/DESIGN-PRINCIPLES.md) | 28 **checkable** design principles used to review every UI PR. | Building or reviewing UI — these are acceptance criteria. |
| [`docs/design/PROTOTYPE-ADDITIONS.md`](docs/design/PROTOTYPE-ADDITIONS.md) | Screen-by-screen gap analysis of the wireframe vs the plan; `docs/design/exports/` has rendered screens. | Designing a screen's content/layout. |
| [`docs/design/Ballroom Builder.dc.html`](docs/design/Ballroom%20Builder.dc.html) | The original wireframe prototype. **A sketch, not requirements.** | Visual language reference only. |
| [`docs/spike/SPIKE-FINDINGS.md`](docs/spike/SPIKE-FINDINGS.md) | M0.5 spike results: Automerge-in-DO proven; **sharp edges** (testing/persistence gotchas). | Working on the DO/sync/persistence layer (M2). |
| [`research/*.md`](research/) | Deep-dive research behind the plan. `extensibility-crdt.md` & `critique-sync.md` are load-bearing for the architecture. | Deep questions the plan summarizes but doesn't fully reproduce. |
| [`PROVISIONING.md`](PROVISIONING.md) | Accounts & secrets (Clerk, Cloudflare) needed to run/deploy. | Running the real app or deploying. |

---

## 2. By task — where to look

- **Implementing a backlog story** → `USER-STORIES.md` (the story + its "unskip when done" tests) → unskip those tests → make them pass (TDD, §4) → check `PLAN.md` for the precise rule.
- **Domain logic** (`packages/domain`: doc schemas, overlay resolution, fork/copy-on-write, undo, registry, timing) → `PLAN.md` §2/§3/§5 + the matching `*.test.ts` (already written, skipped).
- **Worker / Durable Object / sync / permissions / D1** → `PLAN.md` §6 + `SPIKE-FINDINGS.md` + `DEVELOPMENT.md` (harness conventions) + the skipped `apps/worker/src/**/*.test.ts`.
- **UI / components / screens** → `DESIGN-SYSTEM.md` (use the primitives in `apps/web/src/ui`) + `DESIGN-PRINCIPLES.md` (acceptance criteria) + `PROTOTYPE-ADDITIONS.md` + `PLAN.md` §4.
- **Tests / fixtures / E2E** → `TEST-MAP.md` + `DEVELOPMENT.md` (§ harness) + existing fixtures in `packages/domain/src/__fixtures__`, `apps/worker/src/test-support`, `apps/web/e2e/support`.
- **Tooling / CI / config** → `TOOLING.md` (and don't break the layered CI gate).
- **A locked decision feels wrong** → `PLAN.md` §8 + §12 (open/resolved questions). Decisions are cheap to revisit *before* code exists; surface it rather than silently diverging.

---

## 3. Architecture & module boundaries

A **graph of Automerge documents**, one per Durable Object; **D1 is a pure index/registry**
(no CRDT content). Dependency direction: `contract → domain`; `web → contract, domain`;
`worker → contract, domain`.

- **`packages/domain/`** — pure TS, in-memory Automerge, no I/O. Document schemas, `resolve(base, overlay)` variant resolution, fork/clone + copy-on-write, ATTRIBUTE_REGISTRY, float-count timing, history-based per-user undo, Zod, migrations. Fully unit/property-testable.
- **`packages/contract/`** — Zod schemas + Hono RPC `typeof app` types shared across web & worker.
- **`apps/worker/`** — Hono routes (list/search/invite/quota/export), Clerk middleware, and the **per-document SQLite-backed Durable Object** (Automerge host + storage adapter + WebSocket sync + permission boundary + alarm).
- **`apps/web/`** — React PWA. **Components never touch Automerge or the RPC client directly — only through `apps/web/src/store/`** (the typed reactive seam) and `apps/web/src/ui` (design system).

---

## 4. Conventions that bite (read before writing code)

- **TDD, RED→GREEN→REFACTOR.** The whole backlog already has **skipped** tests. To implement a story: unskip its tests (see the story's "unskip when done" block), watch them fail, make them pass, refactor. Don't write implementation before a failing test.
- **The suite must stay green.** Skipped tests must not break collection. **Never top-level-import a not-yet-built product export** — it throws at module load even when skipped. Use `import type` (erased) or a dynamic `await import(...)` *inside* the test body. The typed shim `importDomain()` in `packages/domain/src/__fixtures__/domain-api.ts` is the pattern for domain symbols.
- **Durable Object tests:** `isolatedStorage: false` (SQLite-backed DOs break isolated-storage teardown — M0.5 finding), so **every test must use a unique DO id** (`do-id.ts` helper). Details in `DEVELOPMENT.md`.
- **IDs:** client-generated **ULIDs**. **Soft-delete only** (`deletedAt` tombstones) — never hard removal.
- **Permissions** are enforced **per-document at the DO sync boundary** (and the REST surface) — never by post-hoc CRDT cell rejection.
- **Attribute kinds are data,** not code: editor/lanes/chips render from the merged ATTRIBUTE_REGISTRY (standard + user-defined); respect cardinality and `appliesToDances` (e.g. Tango omits `rise`).
- **TS strict; no `any`** without justification (`noExplicitAny` is a Biome error). Run `pnpm lint && pnpm typecheck` before committing (lefthook enforces both on staged files).
- **Commits:** branch off `main`/`development`; commit/push only when asked. Keep changes within the workspace you own.

---

## 5. Commands

```bash
pnpm dev              # web (Vite) + worker (wrangler dev) together
pnpm test             # all suites (domain + worker/DO + web component)
pnpm test:e2e         # Playwright matrix; pnpm test:e2e:smoke for the @smoke subset
pnpm lint             # Biome (noExplicitAny = error)
pnpm typecheck        # tsc across all 4 workspaces
pnpm coverage         # coverage (thresholds: domain ≥95%, worker ≥90% — uncomment when suites land)
```

---

## 6. Status & how to proceed

- **Done:** M1 domain core; M2 DO sync (per-doc DO, hibernatable WS, alarm compaction, D1 index); M3 auth + permissions + quota + create/build loop — US-001…030 (the relevant ones), plus the Clerk auth chain end-to-end (verify → fail-closed DO boundary → figure-doc projection → WS-token plumbing). **Staging is live and sign-in works** (`ballroom-flow-staging.danielmschmidt.workers.dev`).
- **Delivery model (adopted 2026-06-26):** remaining work ships as **end-to-end-testable features**, gated on their Playwright journey — see `docs/USER-STORIES.md` § "Feature epics (E2E-anchored delivery)". `@smoke` E2E on every PR, full matrix nightly. A feature is "done" only when its journey is green on PR (NOT just unit tests — the M1–M3 stack shipped with zero verified browser journeys, the gap that prompted this).
- **Now:** **#191 — wire E2E auth-mode so the journeys actually run** (the verification keystone), starting with `authoring.spec`. Then build feature-at-a-time (FE-2 share UI, FE-3 figures/fork, …) per the feature-epic table.
- **A large tracked follow-up tail** (security comments, perf, a11y, sortKey convergence, reconnect) lives in the task board — fold each into the feature whose journey it serves.
