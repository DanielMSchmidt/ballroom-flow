# Production-Readiness Review — Weave Steps

**Date:** 2026-07-13 · **Reviewed at:** `b026941` on `main` · **Branch:** `claude/product-quality-readiness-ev3idn`

A full-codebase quality + production-readiness pass: worker security boundary, domain
correctness, web app, test suite, CI/deploy, and doc drift. This document records the
findings, what was fixed in the accompanying PR, and the bigger items that need an owner
decision before launch.

> **Overall:** the codebase is unusually disciplined — strict types with effectively no
> `any`/casts, a real per-document permission boundary, property-tested CRDT convergence,
> compile-time-checked i18n, and a clean store seam. The gaps that matter for *production*
> are concentrated in **operational readiness** (no pre-prod env, no data backup, no rate
> limiting, observability wired-but-dark) and **one authenticated data-read hole** — not in
> the core product logic.

---

## 1. Baseline health (measured this pass)

| Gate | Result |
|---|---|
| `pnpm lint` (Biome) | ✅ clean |
| `pnpm typecheck` (tsc ×4 workspaces) | ✅ clean |
| Domain unit/property | ✅ 285 pass |
| Contract | ✅ pass (bounds added) |
| Worker / DO (workerd) | ✅ pass (a single onboarding test timed out at 5s once under heavy sandbox load — environmental, not a code defect) |
| Web component + axe | ✅ pass |
| **Nightly full E2E matrix** | ❌ **red every run since it was created (2026-07-05)** — see §3 |

## 2. What this PR fixed (clear wins)

**Security / hardening (worker + contract)**
- **Response security headers** — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy` on every worker response, plus a `apps/web/public/_headers` file for the
  static SPA (which the worker never sees). Clickjacking + MIME-sniff hardening. *(No CSP yet —
  that needs validation against Clerk/Sentry/Automerge and is called out in §4.)*
- **Stop leaking query strings to Sentry** — unhandled-error reports now strip the query string
  (`/api/search?q=<user text>` → path only) before sending to a third party.
- **Input-size / enum bounds** on write bodies (`zProfileBody.displayName` ≤80,
  `zFamilyNoteBody.text` ≤4000, `figureType` ≤120, `danceScope` constrained to a dance or
  `"all"`, `zCreateFigure.attributes` ≤2000) — closes an unbounded-persistence vector and a
  dead-data path. *(Does not address the uncapped *count* of figures/notes — that's in §4.)*
- **Migration counts clamp** — the v4→v5 `bars → counts` migration now clamps to the authored
  1–64 ceiling the create schema + LENGTH stepper already enforce, so a legacy oversized figure
  can't migrate to an impossible length.

**Resilience / UX (web)**
- **React error boundary** — the app had none, so any render-time throw dropped the user to a
  blank white screen with no recovery (and, for an offline PWA, possibly unsynced local work
  behind it). Added a localized, reporting, recoverable boundary (`ui/ErrorBoundary.tsx`) around
  the app root.

**Tests / CI**
- **Fixed a stale E2E assertion** — `pwa-a11y.spec.ts` asserted the page title matched
  `/ballroom/i`, but the app was renamed "Weave Steps"; this failed on every matrix run.
- **Case-duplicate test file** — `ChoreoList.test.tsx` collided with `choreo-list.test.tsx` on
  case-insensitive filesystems; renamed to `choreo-list-parity.test.tsx`.
- **CI restructure (owner-requested):** removed the scheduled nightly; the full 3-device
  Playwright matrix now runs as a `full-e2e` job gated on the fast checks passing (`needs:
  fast-gate`), so results are visible on the PR instead of failing silently on a cron. *(It
  RUNS and reports on every PR; it only BLOCKS merge once you add it to branch protection as a
  required check — do that after the journeys in §3 are repaired.)*
- **Truthful a11y comment** — `a11y.test.tsx` claimed Assemble/Share were axe-covered by the
  E2E journey; they are not (that journey runs no axe). Corrected to state the real gap.

**Docs drift** — pnpm 10→11, coverage-thresholds-armed (was "commented out"), migration count
15→17, removed the phantom `export` worker route from CLAUDE.md, refreshed TOOLING.md.

## 3. The full E2E matrix has never been green (needs repair)

The scheduled nightly matrix (chromium-desktop + mobile-chrome + mobile-safari) has **failed on
every run since it was created on 2026-07-05** — most recently 93 passed / 18 failed. Because it
was a cron with **no failure notification**, this stayed invisible. The failing journeys:

- `fork-and-figures` **US-034** (edit own figure persists), **US-035** (global figure → variant),
  **US-040** (cross-dance figureType notes) — chromium **and** mobile
- `journal`, `library` @smoke journeys — mobile only
- `offline-editing`, PWA app-shell — mobile-safari only
- reduced-motion token test — **fixed here** (was the stale title assertion)

These are almost certainly **test-drift** from the recent UI refactors (Builder v3, reading-lens,
create-navigates — #198/#201/#202/#206) that the chromium `@smoke` subset didn't cover, plus
webkit/mobile-specific issues. They predate this PR entirely. **Repairing them needs a
browser-equipped session** (the review sandbox has a mismatched Playwright browser revision).
Until they're green, keep `full-e2e` as a visible-but-non-required check.

## 4. Bigger items needing an owner decision (ranked)

These are not mechanical fixes — each is a strategy/scope call. Recommendation given for each.

1. **[Launch blocker] Snapshot route reads figures with no per-figure authz (IDOR).**
   `GET /api/routines/:id/snapshot` gates only on the caller's role on the *routine*, then reads
   every `figureRef` in that routine's placements with no per-figure check. A user controls their
   own routine's placements, so they can add a placement pointing at any figure docRef they've
   learned and read its full content — bypassing cascade revocation (the WS edit path enforces
   this per-figure; the REST snapshot path does not). *Rec: intersect the figure set with the
   caller's real access (a server-minted `placement_edge`, or `resolveEffectiveRole` per figure).
   Hard-gate change (touches the cascade model).*

2. **No pre-production environment.** `development` was merged to `main` and deleted (2026-07-05),
   but `deploy.yml`/`wrangler.toml` still map `development → staging`. Nothing pushes
   `development` anymore, so **staging receives zero deploys** (stale code + un-migrated D1) and
   every `main` merge goes straight to prod with only CI between. *Rec: pick one — repoint staging
   to deploy from `main` (recommended), recreate a `development` integration branch, or formally
   retire staging — then reconcile the ~6 docs that reference the old model.*

3. **No backup / disaster recovery for the canonical data.** Each document's DO SQLite is the
   source of truth (D1 is only an index). There is no export, off-DO backup, or point-in-time
   recovery — if a DO's storage is lost, that routine/figure is gone and D1 can't reconstruct it.
   *Rec: a scheduled per-DO `A.save` snapshot to R2 (also unlocks user data-export, which PLAN §7
   currently satisfies only via in-app fork).*

4. **Observability is wired but dark.** Sentry reporters (worker + web) and the `clerkConfigured`
   health probe exist, but `SENTRY_DSN`/`VITE_SENTRY_DSN` are unset in every env, and prod's
   `CLERK_SECRET_KEY` was never set (auth fails closed). The 2026-07-05 silent-401 outage produced
   zero Sentry events *because of exactly this*. *Rec: set the DSNs + prod Clerk secret; add an
   external uptime ping on `/api/health`.*

5. **No rate limiting; only routines are quota-capped.** No per-IP/per-user throttle anywhere.
   `FREE_ROUTINE_CAP=3` caps owned routines, but figures, invites, family-notes, and custom-kinds
   are **uncapped** — each `POST /api/figures` mints a DO + D1 rows, so one account can create
   unbounded Durable Objects. *Rec: a Cloudflare rate-limit binding on `/api/*` + a per-user figure
   ceiling. Product call on the limits.*

6. **No route-level code-splitting.** `App.tsx` statically imports every screen, so the initial
   chunk pulls the ~3 MB Automerge WASM + the full ~240-figure catalog + Clerk before a routine is
   even opened — heavy for a mobile-first PWA. *Rec: `lazy()` the Assemble editor + FigureLibrary
   behind `Suspense`.*

7. **CRDT ordering: `keyBetween` throws on equal-key neighbours.** Two clients concurrently
   appending to the same section can produce byte-identical `sortKey`s; a later move *between* them
   calls `keyBetween(x, x)` → uncaught throw in the reorder path. Real but narrow concurrency case,
   untested. *Rec: widen `keyForMove` to the next distinct neighbour on a bound collision, or mint
   keys with a per-actor suffix.*

8. **Coverage/gating gaps.** Web coverage is collected but not threshold-gated; contract Zod tests
   don't run on PR (only on deploy); branch coverage (domain 65, worker 66) is the real debt toward
   the 95/90 line target. *Rec: add the contract test + a web threshold to CI; treat branch
   coverage as the ratchet axis.*

### Smaller follow-ups (clear direction, deferred here)
- Refresh open figure DOs on routine-membership revocation (cascaded sockets keep their role until
  reconnect).
- Cap WS incoming frame size; short-circuit the commenter-frame double-`JSON.stringify` classifier.
- Re-arm a retry alarm when a DO alarm step throws (today it only retries on the next edit).
- Surface IndexedDB quota-exceeded on offline persist (silent today) + evict known-deleted docRefs.
- Add axe coverage for the Assemble editor (the one complex screen with no automated a11y sweep).
- Remove dead exports (`figureGridSlots`, `defaultFigureBars`) and the legacy `copyOnWrite` path.
- Reconcile the skills' "branch off `development`" instruction with the current `main`-only flow.

---

*Generated as part of a full production-readiness review. Clear wins in items §2; §3–§4 are the
tracked backlog. Nothing in §4 blocks continued feature work except item 1, which should be closed
before a real launch.*
