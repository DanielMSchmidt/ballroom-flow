# Ballroom Flow

A collaborative, **mobile-first PWA for building and annotating ballroom dance choreography**.

A *routine* is an ordered sequence of **figures**, each described as a timeline of
**attributes** (footwork, sway, turn, rise, position, …) placed at relative counts.
Figures are **reusable and forkable**: there's an application-wide global library of
canonical figures plus your own account variants, a routine *references* figures, and
refining one of your figures flows into every routine that uses it. You can fork a whole
routine ("make it your own") or fork a figure into a variant that inherits its base and
stores only your overrides. People **annotate** routines — corrections, lessons, practice
notes — anchored to a count, a figure, or a whole cross-dance figure *family*.

It's built on a **CRDT document graph** (Automerge) so collaboration, offline-capability,
and forking are first-class rather than retrofitted.

## Goals & constraints

- **Collaborative & local-first** — concurrent editing merges cleanly; fork/inheritance is the v1 centerpiece.
- **Mobile-first PWA** — installable; performant on phones; desktop also looks good.
- **Cloudflare end-to-end** — Workers + Durable Objects (one Automerge doc per document) + D1 index.
- **Managed auth** — Clerk (no self-run auth).
- **Cheap** — runs on Workers Paid (~$5/mo); a future pro plan monetizes a free quota.
- **Quality & maintainability over feature count** — YAGNI, except the deliberate fork / document-graph investment.

## Tech stack

| Layer | Choice |
|---|---|
| Client | React 19 + Vite PWA, Tailwind v4 design system, TanStack Query, Clerk |
| Data | Automerge CRDT document graph behind a `store/` seam |
| Backend | Cloudflare Worker (Hono) + per-document SQLite-backed Durable Objects |
| Index | D1 (Drizzle) — registry/search only; no CRDT content |
| Contract | Zod + Hono RPC types (`packages/contract`) |
| Tooling | pnpm workspaces, Biome, Vitest (+ `vitest-pool-workers`), Playwright, lefthook |

## Quick start

```bash
pnpm install          # Node 22 (see .nvmrc)
pnpm dev              # runs web (Vite) + worker (wrangler dev) together
pnpm test             # all unit/property/component suites
pnpm test:e2e         # Playwright (chromium-desktop, mobile-chrome, mobile-safari)
pnpm lint             # Biome
pnpm typecheck        # tsc across all workspaces
```

To run/deploy for real you need Clerk + Cloudflare accounts — see [`PROVISIONING.md`](PROVISIONING.md).
Pure domain development (Milestone 1) needs no external accounts.

## Repository layout

```
packages/domain/    pure TS domain logic (Automerge doc schemas, overlay, fork, undo, registry, timing)
packages/contract/  Zod schemas + Hono RPC types shared by web & worker
apps/worker/        Hono Worker + per-document Durable Object + D1 index
apps/web/           React PWA: design system (src/ui), store seam, screens
docs/               PLAN.md (source of truth) + design, tooling, testing, stories
research/           deep-dive research behind the plan's decisions
```

## Where to read more

- **[`docs/PLAN.md`](docs/PLAN.md)** — the single source of truth (domain model, architecture, milestones, locked decisions).
- **[`docs/USER-STORIES.md`](docs/USER-STORIES.md)** — the v1 backlog (US-001…054), each annotated with the tests that should pass when it's done.
- **[`CLAUDE.md`](CLAUDE.md)** — the working guide that routes contributors (human or agent) to the right doc for their task.

> **Status:** Foundations laid (M0 done; design, backlog, test harness, design system, and a full skipped-test scaffold in place). Building starts at **M1 — domain core**.
