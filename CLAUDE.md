# CLAUDE.md — Ballroom Flow

Ballroom Flow is a collaborative, mobile-first **PWA for building and annotating ballroom
dance choreography**, built on an **Automerge CRDT document graph** running on Cloudflare
(Durable Objects + D1, with a React PWA front end). The goal: a couple and their coach
co-edit a routine — figures, per-step technique (footwork, timing, alignment, …), and
threaded notes — that syncs live across their devices.

---

## ⚠️ Start on `development`, not `main`

We use a **git-flow style** workflow with a long-lived integration branch:

- **`development`** — the **active branch**. All feature work, fixes, and docs land here, and
  it deploys to **staging**. **Branch off `development`, and open your PR back into it.**
- **`main`** — the **release branch**. `development` is merged into `main` only when we cut a
  **release**; `main` deploys to **production**. Don't develop directly on `main`.

`main` is intentionally behind `development` between releases. If you're picking up work,
switch to `development` first — a change made on `main` will diverge from the real codebase
and conflict at the next release. When unsure which branch you're on, check before you start.

---

## Canonical source of truth — `docs/PLAN.md`

**`docs/PLAN.md` is the single, canonical source of truth** for how the project works: the
domain model and controlled vocabularies, architecture, locked technical decisions, the
milestone/feature roadmap, and the testing strategy. Resolve any ambiguity against it.

It is a **living document, maintained on `development`** (and promoted to `main` on release).
**Keep it canonical:** when a decision is made or changes, **refine `PLAN.md` in the same
change** so it never drifts from the code — treat plan-vs-code divergence as a bug. The plan
is meant to be continuously refined, not frozen.

---

## Commands

```bash
pnpm build       # build all workspaces
pnpm test        # run the test suites
pnpm lint        # Biome (noExplicitAny = error)
pnpm format      # Biome format --write
pnpm typecheck   # tsc across the workspaces
```

The fuller local workflow — `pnpm dev` (web + worker together), `pnpm test:e2e` (Playwright
journeys), `pnpm coverage` — lives on `development` alongside the running app.

---

## Architecture (one screen)

A **graph of Automerge documents**, one per Durable Object; **D1 is a pure index/registry**
(no CRDT content). Dependency direction: `contract → domain`; `web → contract, domain`;
`worker → contract, domain`.

- **`packages/domain/`** — pure TypeScript domain logic (document schemas, overlay/fork
  resolution, the attribute registry, float-count timing, per-user undo). No I/O.
- **`packages/contract/`** — shared Zod schemas + Hono RPC types.
- **`apps/worker/`** — Hono routes + the per-document SQLite-backed Durable Object (Automerge
  host, WebSocket sync, permission boundary).
- **`apps/web/`** — the React PWA; components reach data only through `apps/web/src/store/`
  (the typed reactive seam), never Automerge or the RPC client directly.
