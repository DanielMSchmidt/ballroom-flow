# CLAUDE.md — working guide for Weave Steps

This file orients any contributor (human or agent) and routes you to the right document
for your task. **It does not duplicate those docs — it points to them.** Read the ones
relevant to your task before writing code.

Weave Steps is a collaborative, mobile-first **PWA for building and annotating ballroom
choreography**, built on an **Automerge CRDT document graph** on Cloudflare. See
[`README.md`](README.md) for the goal in one screen.

**Guiding principle:** *quality and maintainability over feature count* — YAGNI everywhere
**except** the deliberate fork / document-graph investment, which is the v1 centerpiece.

---

## 1. Source of truth & document map

| Document | What it is | Read it when… |
|---|---|---|
| **[`docs/PLAN.md`](docs/PLAN.md)** | **The single source of truth.** Domain model, controlled vocabularies, features-by-screen, collaboration/fork/permissions/undo, architecture, NFRs, **locked technical decisions** (§8), milestone roadmap (§9), testing strategy (§10). | **Always, first.** Any ambiguity is resolved here. |
| [`docs/TEST-MAP.md`](docs/TEST-MAP.md) | Feature/story-key → test-file × layer coverage matrix; flagged gaps. (The old `USER-STORIES.md` backlog was removed 2026-07-02 — `US-…` ids survive only as stable keys in this map, in test names, and in PLAN.md; PLAN.md §9 is the roadmap/status.) | Finding which tests cover a feature, or what's not yet asserted. |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | How to install, run locally, run each test layer, manage env/secrets, and **the test-harness conventions you must follow**. | Setting up; running things; writing tests. |
| [`docs/TOOLING.md`](docs/TOOLING.md) | What dev/test tooling exists, why, and what's deferred (Sentry/Analytics → M8, Lighthouse → M9). | Touching CI, configs, or test infra. |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Token reference, primitive component inventory (`apps/web/src/ui`), responsive/a11y conventions, how to add a component. | Building any UI. |
| **[`docs/design/`](docs/design/)** | **The canonical design source** — a Claude Design (claude.ai/design) handoff bundle. `docs/design/project/*.dc.html` are the HTML/CSS/JS prototypes the UI is recreated from (start with `Ballroom Wireframes v4.dc.html`); read [`docs/design/README.md`](docs/design/README.md) first. | Building or reviewing any UI — match these pixel-for-pixel. |
| [`docs/spike/SPIKE-FINDINGS.md`](docs/spike/SPIKE-FINDINGS.md) | M0.5 spike results: Automerge-in-DO proven; **sharp edges** (testing/persistence gotchas). | Working on the DO/sync/persistence layer (M2). |
| [`research/*.md`](research/) | Deep-dive research behind the plan. `extensibility-crdt.md` & `critique-sync.md` are load-bearing for the architecture. | Deep questions the plan summarizes but doesn't fully reproduce. |
| [`PROVISIONING.md`](PROVISIONING.md) | Accounts & secrets (Clerk, Cloudflare) needed to run/deploy. | Running the real app or deploying. |

> **`docs/PLAN.md` is the canonical, living source of truth — keep it that way.** When a
> decision is made or changes (an attribute model, a locked decision, a roadmap shift),
> **refine `PLAN.md` in the same change** so it never drifts from the code. Treat a divergence
> between `PLAN.md` and the implementation as a bug. The plan is meant to be continuously
> refined, not frozen.

> **`docs/design/` is the canonical design source — prototype there first.** Any change that
> affects the UI **starts in Claude Design** (claude.ai/design): update the `docs/design/project/*.dc.html`
> prototype, then recreate it pixel-for-pixel in the app. Don't design net-new UI directly in
> React — sketch it in the design bundle first so the prototype stays the source of truth, then
> implement. Treat a divergence between the shipped UI and the design bundle as a bug.

---

## 2. By task — where to look

- **Implementing a feature** → `PLAN.md` §9 (roadmap + the active milestone) for scope → `TEST-MAP.md` for the covering tests → write/unskip tests first, make them pass (TDD, §4) → check `PLAN.md` for the precise rule.
- **Domain logic** (`packages/domain`: doc schemas, variant/overlay resolution, fork, undo, registry, timing) → `PLAN.md` §2/§3/§5 + the matching `*.test.ts`.
- **Worker / Durable Object / sync / permissions / D1** → `PLAN.md` §6 + `SPIKE-FINDINGS.md` + `DEVELOPMENT.md` (harness conventions) + the skipped `apps/worker/src/**/*.test.ts`.
- **UI / components / screens** → **prototype the change in Claude Design first** (update `docs/design/project/*.dc.html`), then `DESIGN-SYSTEM.md` (use the primitives in `apps/web/src/ui`) + the `docs/design/` bundle (the canonical visual source — recreate it pixel-for-pixel) + `PLAN.md` §4.
- **Tests / fixtures / E2E** → `TEST-MAP.md` + `DEVELOPMENT.md` (§ harness) + existing fixtures in `packages/domain/src/__fixtures__`, `apps/worker/src/test-support`, `apps/web/e2e/support`.
- **Tooling / CI / config** → `TOOLING.md` (and don't break the layered CI gate).
- **A locked decision feels wrong** → `PLAN.md` §8 + §12 (open/resolved questions). Decisions are cheap to revisit *before* code exists; surface it rather than silently diverging.

### Skill library (`.claude/skills/`)

Deep-dive skills live in [`.claude/skills/`](.claude/skills/). They **complement — never
override — `PLAN.md`**; on any conflict, PLAN.md wins. Load the one matching your task:

| Task type | Skill |
|---|---|
| **Any change** — classify it, pick the branch, know which gates/rules apply (load **before** editing) | `ballroom-flow-change-control` |
| Setup, install/build/test failures, sandbox Playwright, secrets & zero-secret matrix | `ballroom-flow-build-and-env` |
| Run locally, deploy, wrangler envs, D1 migrations, ops actions | `ballroom-flow-run-and-operate` |
| Writing/changing any test; layers, "done" bar, coverage ratchet | `ballroom-flow-validation-and-qa` |
| Measuring: query plans, coverage, axe, traces, flake repro, DO internals | `ballroom-flow-diagnostics-and-tooling` |
| Something broken/flaky/weird — symptom → experiment triage before touching code | `ballroom-flow-debugging-playbook` |
| Designing changes to data shape, doc boundaries, sync, permissions, module structure | `ballroom-flow-architecture-contract` |
| Automerge/CRDT reasoning: convergence, sharp edges, overlays, undo, ordering | `ballroom-flow-crdt-reference` |
| Ballroom concepts (timing, footwork, rise, alignment) → this codebase's enums | `ballroom-dance-reference` |
| Figure/seed data, chart corrections, regenerating library artifacts | `ballroom-flow-figure-data-pipeline` |
| The **v5 live-figure migration** (the active milestone; variants, `resolveFigure`, hardening tail) | `ballroom-flow-v5-migration-campaign` |
| Proving a claim: convergence, undo soundness, authz safety, D1 perf; reviewing such PRs | `ballroom-flow-proof-and-analysis` |
| Hunch → accepted change: evidence bar, adversarial refutation, root-cause-before-fix | `ballroom-flow-research-methodology` |
| Before re-litigating anything settled — past investigations, reversals, dead ends | `ballroom-flow-failure-archaeology` |
| Scoping beyond the milestone; any proposed external claim (blog/paper/benchmark) | `ballroom-flow-research-frontier` |

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
# Toolchain: node 22 (.nvmrc), pnpm 11 (pinned via packageManager in package.json)
pnpm dev              # web (Vite) + worker (wrangler dev) together
pnpm test             # all suites (domain + contract + worker/DO + web component)
pnpm test:e2e         # Playwright matrix; pnpm test:e2e:smoke for the @smoke subset
pnpm lint             # Biome (noExplicitAny = error)
pnpm typecheck        # tsc across all 4 workspaces
pnpm coverage         # coverage — thresholds ARMED: domain ≥90, worker ≥88 lines (ratchet toward 95/90, PLAN §10.3)
```

---

## 6. Status & how to proceed

- **Done:** M1 domain core; M2 DO sync (per-doc DO, hibernatable WS, alarm compaction, D1 index); M3 auth + permissions + quota + create/build loop — US-001…030 (the relevant ones), plus the Clerk auth chain end-to-end (verify → fail-closed DO boundary → figure-doc projection → WS-token plumbing). **Staging is live and sign-in works** (`weave-steps-staging.danielmschmidt.workers.dev`).
- **Delivery model (adopted 2026-06-26):** remaining work ships as **end-to-end-testable features**, gated on their Playwright journey (`apps/web/e2e/*.spec.ts`). `@smoke` E2E on every PR, full matrix nightly. A feature is "done" only when its journey is green on PR (NOT just unit tests — the M1–M3 stack shipped with zero verified browser journeys, the gap that prompted this).
- **Now (2026-07-02):** the **v5 migration milestone** — `PLAN.md` §9 — converts the figure layer to the live-figure/overlay-variant model (PLAN v5.0, §5.2) and lands the review hardening (undo soundness, figures-route authorization, non-destructive projections, post-connect role enforcement, bounded catch-up).
- **A large tracked follow-up tail** (security comments, perf, a11y, sortKey convergence, reconnect) lives in the task board — fold each into the feature whose journey it serves.

---

## 7. Git flow & releases (read before branching)

We use a **git-flow style** with a long-lived integration branch:

- **`development`** is the **active branch** — all feature work, fixes, and docs land here.
  **Branch off `development`** for new work and open your PR back into `development`.
  (`development` deploys to **staging**.)
- **`main`** is the **release branch** — `development` is merged into `main` only when we cut a
  **release**. `main` deploys to **production**. Don't develop directly on `main`; it should
  only ever receive `development` (or a hotfix that is also back-merged to `development`).

So: **start from `development`, not `main`.** A change made on `main` that isn't a release will
diverge from the real codebase and conflict at the next release. If you're unsure which branch
you're on, check before you start — the wrong base is expensive to unwind.
