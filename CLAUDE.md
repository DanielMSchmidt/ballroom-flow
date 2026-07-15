# CLAUDE.md — working guide for Weave Steps

Weave Steps is a collaborative, mobile-first **PWA for building and annotating ballroom
choreography**, built on an **Automerge CRDT document graph** on Cloudflare. See
[`README.md`](README.md) for the goal in one screen.

**Guiding principle:** *quality and maintainability over feature count* — YAGNI everywhere
**except** the deliberate fork / document-graph investment, which is the centerpiece.

---

## 1. Read the index first — then keep both doc layers true

**[`docs/README.md`](docs/README.md) is the mandatory entry point for every session.** It
carries the product's mental model in one screen and routes to everything else. The
documentation has two layers:

- **[`docs/concepts/`](docs/README.md)** — the mental model: what the product's world
  contains and how it behaves, detached from implementation.
- **[`docs/system/`](docs/README.md)** — the technical understanding: how it works
  underneath (architecture, sync/offline, testing), plus the working docs
  (`DEVELOPMENT.md`, `TOOLING.md`, `DESIGN-SYSTEM.md`, `TEST-MAP.md`).

**The standing rule: every change that alters behavior updates both layers in the same
change** — the affected concept docs *and* the affected system docs must read true
afterwards. A doc-vs-code divergence is a bug, same priority as a failing test. (This
replaces the former `docs/PLAN.md` + WEP process — see the index's "For historians" table
for how old `PLAN §…`/`WEP-…` citations in code comments and skills decode.)

**Substantive future work starts as an idea in [`docs/ideas/`](docs/ideas/README.md)** —
a design doc with a named concrete scenario, a Playwright ship gate, and an explicit
**mental-model delta**. An idea in that folder is not built; shipping one folds its delta
into the two doc layers and **deletes the idea file** in the same change. Needed for:
data-shape / boundary / sync / permission changes, multi-PR features, new dependencies or
services, or reversing a documented design rule. Not needed for: bug fixes,
behavior-preserving refactors, design-parity UI, sourced seed-data corrections.

> **`docs/design/` is the canonical design source — prototype there first.** Any change that
> affects the UI **starts in Claude Design** (claude.ai/design): update the
> `docs/design/project/*.dc.html` prototype (start with `Ballroom Builder v3.dc.html`), then
> recreate it pixel-for-pixel in the app. Shipped-UI-vs-bundle divergence is a bug.

---

## 2. Architecture & module boundaries (one paragraph)

A **graph of Automerge documents**, one per Durable Object; **D1 is a pure index/registry**
(no CRDT content). Dependency direction: `contract → domain`; `web → contract, domain`;
`worker → contract, domain`. `packages/domain` is pure TS (no I/O); `apps/worker` hosts the
per-document SQLite-backed DO (sync + permission boundary + alarm projections);
**`apps/web` components never touch Automerge or the RPC client directly — only through
`apps/web/src/store/`** and the `apps/web/src/ui` design system. Full picture:
[`docs/system/architecture.md`](docs/system/architecture.md).

## 3. Conventions that bite (read before writing code)

- **TDD, RED→GREEN→REFACTOR.** Write or unskip the covering test first, watch it fail, make
  it pass. A feature is "done" only when its **Playwright journey is green on the PR**
  (`@smoke` on every PR, full matrix nightly) — unit-green is not done
  ([`docs/system/testing.md`](docs/system/testing.md)).
- **The suite must stay green.** Never top-level-import a not-yet-built product export — it
  throws at module load even in a skipped test. Use `import type` or a dynamic
  `await import(...)` inside the test body (the typed shim `importDomain()` in
  `packages/domain/src/__fixtures__/domain-api.ts` is the pattern).
- **Durable Object tests:** `isolatedStorage: false` (SQLite-backed DOs break
  isolated-storage teardown), so **every test uses a unique DO id** (`do-id.ts` helper).
- **IDs are client-generated ULIDs. Soft-delete only** (`deletedAt` tombstones) — never hard
  removal, never delete-and-reinsert to move (moves use `sortKey`).
- **Permissions are enforced per-document at the DO sync boundary** (and the REST surface) —
  never by post-hoc CRDT cell rejection.
- **Attribute kinds are data,** not code: surfaces render from the merged registry; respect
  cardinality and dance gates (Tango omits `rise`).
- **Never invent domain data.** Figure/seed values come from verifiable sources with
  recorded provenance; unverifiable content is omitted, never guessed.
- **TS strict; no `any`** (`noExplicitAny` is a Biome error). Run
  `pnpm lint && pnpm typecheck` before committing (lefthook enforces on staged files).
- **Keep types honest — a cast is a claim the compiler can't check, so it's a latent bug.**
  Machine-enforced: a GritQL plugin (`lint-plugins/no-type-assertion.grit`) errors on every
  `as`/`<T>` assertion (`as const` allowed), Biome errors on `any`/`!`/`@ts-ignore`, and
  `scripts/check-type-suppressions.mjs` bans `@ts-expect-error` (see `docs/TOOLING.md`
  § Type-honesty enforcement). First make the type honest at the source (fix the
  declaration, add a generic, narrow with a type guard). A cast is acceptable only at a
  boundary the type system genuinely can't express, in one small named documented helper
  stating what guarantees the claim at runtime. `as unknown as X` is the loudest smell —
  fix the layer, don't double-cast the call site.
- **Flakes get root-caused, never retried/loosened away**; weakening a test to pass needs
  the same justification as deleting the feature it covers.
- **No new dependencies without owner sign-off.** (pnpm 11 trap: a dep with a postinstall
  build script silently won't build unless added to `allowBuilds` in
  `pnpm-workspace.yaml`.)

## 4. Skill library (`.claude/skills/`)

Deep-dive skills complement the docs — **on any conflict, `docs/concepts/` +
`docs/system/` win** (skills are dated snapshots; some still cite the dissolved `PLAN.md` by
section — decode via the index's historians table). Load the one matching your task:

| Task type | Skill |
|---|---|
| **Any change** — classify it, know which gates/rules apply (load **before** editing) | `ballroom-flow-change-control` |
| Setup, install/build/test failures, sandbox Playwright, secrets | `ballroom-flow-build-and-env` |
| Run locally, deploy, wrangler envs, D1 migrations, ops actions | `ballroom-flow-run-and-operate` |
| Writing/changing any test; layers, "done" bar, coverage ratchet | `ballroom-flow-validation-and-qa` |
| Measuring: query plans, coverage, axe, traces, flake repro, DO internals | `ballroom-flow-diagnostics-and-tooling` |
| Something broken/flaky/weird — symptom → experiment triage first | `ballroom-flow-debugging-playbook` |
| Designing changes to data shape, boundaries, sync, permissions, modules | `ballroom-flow-architecture-contract` |
| Automerge/CRDT reasoning: convergence, sharp edges, overlays, undo, ordering | `ballroom-flow-crdt-reference` |
| Ballroom concepts (timing, footwork, rise) → this codebase's enums | `ballroom-dance-reference` |
| Figure/seed data, chart corrections, regenerating library artifacts | `ballroom-flow-figure-data-pipeline` |
| The v5 live-figure migration history (complete; variants, `resolveFigure`) | `ballroom-flow-v5-migration-campaign` |
| Proving a claim: convergence, undo soundness, authz safety, D1 perf | `ballroom-flow-proof-and-analysis` |
| Hunch → accepted change: evidence bar, adversarial refutation | `ballroom-flow-research-methodology` |
| Before re-litigating anything settled — past investigations, reversals | `ballroom-flow-failure-archaeology` |
| Scoping beyond current work; any proposed external claim | `ballroom-flow-research-frontier` |

## 5. Commands

```bash
# Toolchain: node 22 (.nvmrc), pnpm 11 (pinned via packageManager in package.json)
pnpm dev              # web (Vite) + worker (wrangler dev) together
pnpm test             # all suites (domain + contract + worker/DO + web component)
pnpm test:e2e         # Playwright matrix; pnpm test:e2e:smoke for the @smoke subset
pnpm lint             # Biome (noExplicitAny = error) + type-honesty plugins
pnpm typecheck        # tsc across all 4 workspaces
pnpm coverage         # thresholds ARMED: domain ≥90, worker ≥88 lines (ratchet up)
```

## 6. Git flow & releases (read before branching)

We do **PR-driven development**: every change — feature, fix, or docs — lands on its own
**feature branch** and merges into `main` through a **pull request**. **Never commit
directly to `main` — it deploys to production** (merging a PR is a release).

- **Branch off `main`** (`fix/…`, `feat/…`, `chore/…`). **Commit and push as you go — you
  don't need to be asked.** Open a PR, keep it focused, **don't merge red**.
- Worker/permission/security-touching changes are **hard-gated in review** — this repo's
  worst bugs all lived in "small-looking" diffs of exactly that class.
- Historical note: a `development` → staging branch existed until 2026-07-05 (merged in
  PR #161, deleted); everything flows through `main` now. Older skills/docs that say
  "branch off `development`" are stale on that point.

If you're unsure which branch you're on, check before you start — committing to `main` is
expensive to unwind.
