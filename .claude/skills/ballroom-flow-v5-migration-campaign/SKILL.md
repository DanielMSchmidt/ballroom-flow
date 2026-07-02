---
name: ballroom-flow-v5-migration-campaign
description: Load when working on the v5 live-figure migration — the active engineering milestone (PLAN §9) — global figure docs, overlay/variant resolution in the web store, library-as-bookmark, fork v5, admin seams, or the remaining sync/undo hardening (snapshot-frame catch-up, reconnect resend, migration ladder on the DO load path, figure-editor undo). Also load when a task mentions "variant", "spawnVariant", "resolveFigure", "frozen copy", "per-beat ownership", or the "Passing Tumble Turn".
---

# The v5 live-figure migration campaign

This is the executable runbook for finishing the v5 migration milestone (docs/PLAN.md §9, "v5 migration milestone", lines ~445–456). Work the phases in order; each has a gate you must observe passing before moving on.

**When NOT to use this:** for CRDT/Automerge concepts (per-beat ownership mechanics, undo internals, convergence testing) read **ballroom-flow-crdt-reference**; for the frozen module boundaries and locked decisions read **ballroom-flow-architecture-contract**; for how to run/test anything read **ballroom-flow-build-and-env** and **ballroom-flow-validation-and-qa**; for PR/TDD/PLAN-update doctrine read **ballroom-flow-change-control**; for debugging a failure you didn't cause read **ballroom-flow-debugging-playbook**; for seeding/charting figure content read **ballroom-flow-figure-data-pipeline**.

## 1. Mission context (read once)

- **v5 = live figures + per-beat overlay variants** (PLAN §5.2, §2.5.1 invariants #14–18). A placed catalog figure is a **live reference** to a global, admin-owned figure doc. A non-admin's first edit **spawns a variant**: an account figure whose `baseFigureRef` is a *live* link, carrying **only the beats it owns**; everything else resolves live from the base.
- **Canonical scenario (PLAN §5.2, line ~280):** a Slowfox choreo places the catalog *Tumble Turn* twice — one plain, one re-choreographed as a *Passing Tumble Turn* (last ~3 beats changed). When the catalog figure later gains new attribute values, the plain placement shows them everywhere; the Passing variant shows them **only on its untouched beats**.
- **Why frozen copies were retired:** the 2026-06-29 "frozen copy" model (PRs #97/#99/#100/#104) cut variants off from catalog improvements. PLAN v5.0 (PR #132, e27bca6/17eee40, 2026-07-02) reversed it after working the model against the Passing Tumble Turn scenario. Per-beat ownership is the precision the original v4 overlay lacked. Model history: live-overlay → frozen-copy → live-overlay-with-per-beat-ownership.
- **Back-compat guarantee (PLAN §9, line ~456): NO data migration.** A v4 frozen copy carries content on every beat it uses, so it **owns every such beat** (invariant #15) and `resolveFigure(base, copy)` returns exactly its current timeline. Its `baseFigureRef` becoming live changes nothing until the catalog adds values on beats the copy never touched. Existing catalog-seeded placements keep their account docs; **only new catalog adds become live references**.

## 2. Current-state audit (verified at HEAD 70eed7e, 2026-07-02)

| Item | State | Evidence |
|---|---|---|
| Domain v5 helpers (step 2) | ✅ DONE | `packages/domain/src/fork.ts`: `ownedBeats` :117, `resolveFigure` :132, `variantAttributesForEdit` :166, `spawnVariant` :205, `copyFigureForFork` :237. Tests: `fork.test.ts` "⟳v5 overlay variants (per-beat ownership)" :229, Passing Tumble Turn scenario :281 |
| Undo soundness (identity-anchored inverse, revert-at-most-once) | ✅ DONE | 3725ec9 (PR #132); `packages/domain/src/undo.ts`, `undo.test.ts` |
| `POST /api/figures` authorization (editor-of-routine required, no cross-owner upsert) | ✅ DONE | 089dbc0; `apps/worker/src/index.ts` :318 |
| Non-destructive alarm projection (doc-derived identity) | ✅ DONE | 9edab0a; `apps/worker/src/doc-do.ts` alarm/projectToD1 |
| Post-connect role re-enforcement + annotation authorship | ✅ DONE | 99fa1b9; `doc-do.ts` `refreshConnectedRoles` :543 |
| Snapshot-frame catch-up | ☐ OPEN | `doc-do.ts` :428 still per-change replay: `for (const change of A.getAllChanges(current)) server.send(change)` |
| Reconnect resend of unacked local changes (#161) | ☐ OPEN | `apps/web/src/store/doc-connection.ts` :105–111 — `pendingSends` buffer is labelled "a precursor to full reconnect resend, #161" |
| Broadcast-send failure → mark socket for resync | ☐ OPEN | `doc-do.ts` `broadcast` :615 — send failure is silently skipped (:624–626), no resync marker |
| Migration ladder on DO load path + stamp fresh docs | ☐ OPEN | `packages/domain/src/migrations.ts` `migrate()` :170 has **no runtime caller** (tests/fixtures only); `doc-do.ts` `emptyRoutine()` hardcodes `schemaVersion: 1` :97 while `CURRENT_SCHEMA_VERSION = 4` (migrations.ts:25) |
| Figure-editor undo targets the figure doc | ☐ OPEN | `apps/web/src/store/routine.ts` `undo()` :970 / `redo()` :983 commit to `routineConn` only |
| Step 3: global figure docs + store rewiring | ☐ OPEN | No production writer of `type='global-figure'` registry rows (only `routes/test-seed.ts` :180); store `resolveFigure` :1115 is frozen-style ("no live overlay against a base"); `editFigure` :1010 still calls legacy `copyOnWrite` :1033; worker snapshot :764–776 mirrors frozen-style |
| Step 4: library-as-bookmark | ☐ OPEN | `libraryFigureRefs` appears nowhere in `packages/` or `apps/` source |
| Step 5: fork v5 (copy account figures) | ☐ OPEN | `apps/worker/src/fork.ts` :56–57 — "Referenced figures stay shared"; `copyFigureForFork` has no worker caller |
| Step 6: admin seams | ☐ OPEN | `isAdmin` / `routineCapOverride` appear nowhere in source; 13 D1 migrations exist (0001–0013) |

Re-audit before starting — later sessions may have landed some of these (see Provenance).

## 3. Standing orders for every phase

- **TDD.** Write/extend the failing test first (RED), implement (GREEN), refactor. See **ballroom-flow-change-control** for the full doctrine.
- **Branch off `development`** (never `main` — the #83/#85 revert cost ~1269 lines). PR back into `development`.
- **PLAN.md moves with the code:** flip the matching §9 checkbox and reconcile any superseded prose (and docs/TEST-MAP.md rows) **in the same PR**. Divergence between PLAN and code is a bug.
- Commands (from repo root; package filters are `@ballroom/domain`, `worker`, `web`):

```bash
pnpm --filter @ballroom/domain test   # 227 passed / 3 skipped as of 2026-07-02, ~5s
pnpm --filter worker test             # 150 passed / 7 skipped as of 2026-07-02, ~50s
pnpm --filter web test                # 331 passed as of 2026-07-02
pnpm lint && pnpm typecheck           # both must be clean before commit (lefthook enforces)
pnpm test:e2e:smoke                   # Playwright @smoke; in sandboxes add --project=chromium-desktop
```

- Worker/DO tests: `isolatedStorage: false` — every test needs a **unique DO id** (`apps/worker/src/test-support/do-id.ts`). D1 query shape changes go through the EXPLAIN no-SCAN gate (`apps/worker/src/test-support/explain.ts`).

## 4. Phases (PLAN §9 sequence — hardening first, no model change; then steps 3→6)

### Phase 0 — Preflight (every session)

```bash
git branch --show-current                       # must be a feature branch off development
grep -n -A 12 "v5 migration milestone" docs/PLAN.md | head -20   # which boxes are already flipped?
pnpm --filter @ballroom/domain test             # baseline green before you touch anything
```

Read PLAN §5.2 (lines ~278–288) and §2.5.1 #14–20 (lines ~143–151) in full — every phase below cites them by invariant number. Then pick the **first unflipped box** in §9's order; do not start step 3 while a step-1 box is open (the sequence exists to keep the suite green throughout).

### Phase 1a — Snapshot-frame catch-up (D10)

**Entry state:** `doc-do.ts` fetch() replays every historical change on connect (:425–430), then sends the text frame `SYNC_CAUGHT_UP` (`"ballroom:sync:caught-up"`, `packages/contract/src/index.ts` :140).
**TDD entry:** extend `apps/worker/src/doc-do.test.ts` (connect/catch-up cases) — assert a long-history doc catches a fresh client up with **one** binary frame (an `A.save` blob) followed by `SYNC_CAUGHT_UP`; extend `apps/web/src/store/` connection tests so the client applies a snapshot frame (e.g. `A.loadIncremental` / merge) as well as raw change frames.
**Care:** the not-yet-seeded doc must still send an empty catch-up + marker without materializing a placeholder (the c43ebed no-clobber lesson — read via `loadPersisted()`, never `getDoc()`); the two-client convergence and commenter journeys must not regress.
**Gate:** `pnpm --filter worker test` green; `pnpm test:e2e:smoke` green (convergence.spec.ts @smoke exercises live catch-up).
**Exit:** PLAN §9 step 1 "snapshot-frame catch-up" half-box addressed; PLAN §6 already describes the target ("connect catch-up = ONE snapshot frame, not a per-change replay") so no prose change needed — just the checkbox when the pair (with 1a′) is done.

### Phase 1a′ — Reconnect resend (#161) + broadcast-failure resync

**Entry state:** `doc-connection.ts` buffers only pre-open sends (`pendingSends` :111); changes acked-by-nobody at socket drop can be lost. `broadcast` (doc-do.ts:615) swallows send failures.
**TDD entry:** `apps/web/src/store/doc-connection.test.ts` — simulate a socket drop after local changes, assert they are re-sent after reconnect + catch-up (idempotent on the server: `ingestChange` dedupes via `headsEqual`, doc-do.ts:67). Worker side: a socket whose `send` throws must be marked and receive a full resync (or be closed to force the client's reconnect path) — pin in `doc-do.test.ts`.
**Gate:** worker + web suites green; `apps/web/e2e/convergence.spec.ts` @smoke green.
**Exit:** flip the "☐ snapshot-frame catch-up + reconnect resend (D10)" box in PLAN §9 step 1.

### Phase 1b — Migration ladder on the DO load path + stamp fresh docs

**Entry state:** `migrate()` (migrations.ts:170) is called only by tests; `emptyRoutine()` stamps `schemaVersion: 1` (doc-do.ts:97) despite `CURRENT_SCHEMA_VERSION = 4`.
**TDD entry:** `doc-do.test.ts` — persist a doc shaped like an older schemaVersion, `reloadForTest()`, assert reads see the migrated shape and `schemaVersion === CURRENT_SCHEMA_VERSION`; assert a freshly materialized doc is stamped current. Domain-side ladder behavior is already pinned (`migrations.test.ts`) — don't re-test it, wire it.
**Care:** the ladder must run as an Automerge change (mutating inside `A.change`), be idempotent (a current doc is a no-op — `migrate(current)` returns it unchanged), and never write `undefined` (Automerge throws; `stripUndefined` exists in `doc-internal.ts`). Identity fields `figureType`/`dance` are immutable through migration (`IMMUTABLE_IDENTITY_FIELDS`, migrations.ts:146).
**Gate:** `pnpm --filter worker test` green; `pnpm --filter @ballroom/domain test` still 227+ passing.
**Exit:** flip the PLAN §9 step 1 ladder box; if you bump `CURRENT_SCHEMA_VERSION` for v5 shapes later, that is a separate ladder step — never edit an existing one.

### Phase 1c — Figure-editor undo targets the figure doc

**Entry state:** `routine.ts` `undo()`/`redo()` (:970/:983) always commit to `routineConn`. PLAN §5.4 (LOCKED): "undo follows the surface being edited" — the figure editor's no-Save contract is only honest if figure edits are undoable there.
**TDD entry:** `apps/web/src/store/routine-store.test.ts` — after `setFigureAttributes` on an open figure, `undo()` must revert the **figure doc**, not the routine's last change. Then extend `apps/web/e2e/undo.spec.ts` (@smoke) with a figure-editor undo journey.
**Solution latitude:** (i) `undo(target?: { figureRef })` parameter chosen by the active surface, or (ii) the store tracks the "active editing surface" and routes `undo()`. Either way `wasSupersededByOthers` must peek the doc being undone.
**Gate:** web suite green; `pnpm test:e2e:smoke` green including the new journey.
**Exit:** flip the PLAN §9 step 1 undo box.

### Phase 2 — Domain v5 helpers (✅ done — verify, don't rebuild)

Run `pnpm --filter @ballroom/domain test`. Expect 227+ passing (as of 2026-07-02), including fork.test.ts :281 (Passing Tumble Turn). If `resolveFigure` ever returns base data on a beat the variant owns, you violated invariant #15 — stop and read the per-beat ownership section of **ballroom-flow-crdt-reference** before touching fork.ts.

### Phase 3 — Global figure docs + THE STORE REWIRING (the crux)

**Entry state:** catalog placements are seeded as account docs from the bundled `LIBRARY_FIGURES` (routine.ts `addPlacement` :736–794); global-figure registry rows exist only in tests; `editFigure` :1010 forks a frozen copy via `copyOnWrite`; store `resolveFigure` :1115 and the worker snapshot (index.ts:764–776) do no base resolution.

Sub-steps, each TDD'd, sequenced to keep the suite green:

1. **Additive seeder into real global docs (D30).** Import bundled catalog figures into per-figure DOs + `document_registry` rows (`type='global-figure'`, app-owned). **Additive-only:** a doc that exists is never overwritten — the doc is the source of truth after import; re-runs only add missing figures. TDD in a new `apps/worker/src/` test using `seedDoc` (no-clobber already built, doc-do.ts:208) + unique DO ids. Ref format precedent: `globalFigureRef(dance, figureType)` = `global:<dance>:<figureType>` (`packages/domain/src/library.ts` :97).
2. **Admin read/write boundary.** Global figure docs: all authenticated users read; only admins write (PLAN §6). Enforce in the DO's role resolution (extend `resolveEffectiveRole` / the DO fetch gate, doc-do.ts:396) — **never** by post-hoc change rejection alone; the effect-based classifier (`commenterChangeAllowed`, doc-do.ts:484) is the pattern if a finer gate is needed. Depends on Phase 6's `isAdmin` column *or* stub it read-only-for-all until Phase 6 lands (all-read/no-write is safe and unblocks the rest).
3. **Snapshot returns variant bases.** `GET /api/routines/:id/snapshot` (index.ts:745) must also fetch each variant's `baseFigureRef` doc and return it (PLAN §6.2: "routine + placed figures + variant bases, resolved per-beat client-side"). TDD in `apps/worker/src/` snapshot tests.
4. **Store rewiring.** (a) New catalog adds become live references (placement's `figureRef` = the global doc ref; no account doc minted). (b) `editFigure` on a `scope === "global"` figure switches from `copyOnWrite` → `spawnVariant` + `variantAttributesForEdit` (edit the *resolved* timeline, hand the whole intended content to `variantAttributesForEdit`). (c) Store `resolveFigure` :1115 resolves a variant against its (possibly snapshot-stale) base via domain `resolveFigure`. TDD in `routine-store.test.ts` (the existing COW cases at :759–:975 are your template — rewrite them to the variant semantics, don't delete them).
5. **Reconcile the journeys + docs in the same PR(s):** `apps/web/e2e/fork-and-figures.spec.ts` :154 currently asserts "editing a GLOBAL figure auto-creates your frozen copy" — rewrite to variant semantics (edited beats owned, untouched beats live). Update TEST-MAP.md rows US-035/US-036 (both still record the frozen reconciliation). Do NOT "fix" PLAN §12's older frozen-model Q-entries — they are deliberately retained for lineage under the "Resolved 2026-07-02 (the v5 reversal — supersedes …)" header.

**Gate observations:** `pnpm --filter @ballroom/domain test` → 227+N passing; `pnpm --filter web test` green with zero remaining assertions of "frozen snapshot, no overlay"; `pnpm test:e2e:smoke` green including the rewritten fork-and-figures journey; back-compat pinned by a test where a full-timeline account figure (v4 copy shape) resolves to exactly its own timeline against any base.
**Exit:** flip PLAN §9 step 3; `copyOnWrite` remains in fork.ts read-only for legacy data (do not delete it in this phase).

### Phase 4 — Library-as-bookmark

**Entry state:** `POST /api/figures/save-to-library` (index.ts:412) mints an idempotent account **copy**; account doc has no `libraryFigureRefs`.
**TDD entry:** domain `doc-account.test.ts` (add/remove bookmark, un-bookmark never deletes the doc — PLAN §5.2); worker tests for the bookmark route + `LibraryEntry` projection; component test for the "add to my library" affordance. Note `packages/domain/src/doc-account.ts` is built but **not yet wired to a DO** — wiring the account doc is part of this phase's worker work.
**Gate:** `apps/web/e2e/library.spec.ts` (@smoke) green on the bookmark semantics (two users bookmarking the same shared figure → one doc, no copy).
**Exit:** flip PLAN §9 step 4; `save-to-library` semantics change is reconciled in TEST-MAP.

### Phase 5 — Fork v5

**Entry state:** `apps/worker/src/fork.ts` `forkRoutineFor` :37 clones the routine snapshot only; figures stay shared.
**TDD entry:** worker fork tests — after fork, every referenced **account** figure has a forker-owned copy (via domain `copyFigureForFork`: variants copied **as variants**, same `baseFigureRef` + owned beats; customs copied plain), placements re-pointed; **global refs stay live** (not copied). Registry + membership rows projected for each copy; quota untouched (figures aren't routines).
**Gate:** `apps/web/e2e/fork-and-figures.spec.ts` fork journey green: post-fork, origin edits to an account figure do NOT reach the fork; catalog base additions DO reach the fork's variant's untouched beats.
**Exit:** flip PLAN §9 step 5.

### Phase 6 — Admin seams (D31)

**Entry state:** no `isAdmin`/`routineCapOverride` anywhere; 13 migrations exist → next is `apps/worker/migrations/0014_*.sql` (+ Drizzle `db/schema.ts` update).
**TDD entry:** worker tests — quota gate reads `routineCapOverride` (extend `countOwnedRoutines`/cap logic in `db/routines.ts`, `FREE_ROUTINE_CAP = 3` :18); the global-figure write boundary from Phase 3.2 flips from stub to `isAdmin`. Elevation (`account → global` re-scope, same ref) is an **ops action** in v1 — build the seam, not a UI (queue UI is v1.1, PLAN §11).
**Gate:** worker suite green; EXPLAIN gate clean on any new query; `pnpm test:e2e:smoke` green.
**Exit:** flip PLAN §9 step 6 — the milestone is complete; propose the release per **ballroom-flow-change-control**.

## 5. Fenced-off wrong paths (do NOT)

| Do NOT | Why |
|---|---|
| Create frozen copies for new divergence | Retired by PLAN v5.0 (D12 ⟳v5). `copyOnWrite` is legacy-read-only; new divergence goes through `spawnVariant` |
| Mutate the base on a variant edit, or let a base edit rewrite owned beats | Invariant #17 (PLAN §2.5.1). `spawnVariant`/`variantAttributesForEdit` are pure — keep it that way through the store |
| Write a data migration for v4 frozen copies | The back-compat guarantee makes it unnecessary (PLAN §9); a migration adds risk for zero benefit |
| Address Automerge list elements by positional index across time, or move by delete-and-reinsert | Bit this repo twice (splice reorder 38dfba7/PR #107; undo inverse 3725ec9). Identity (ids) + `sortKey` only |
| Bypass the DO boundary for admin writes (e.g. direct D1/SQLite edits of doc content) | Permissions are enforced per-document at the DO sync boundary (PLAN §5.1, CLAUDE.md §4); D1 is a derived index, never the source of truth |
| Let the seeder overwrite an existing global doc | D30: additive-only; after import the doc is the source of truth, refined by admin in-app edits |
| Weaken/skip a failing test to get green | House rule; flakes get root-caused (see ballroom-flow-failure-archaeology) |
| Compare variant/base attributes by `id` or including `deletedAt` | Divergence + ownership compare **by meaning** `kind\|count\|role\|value` (invariant #20, `attrMeaning` fork.ts:104) |

## 6. Solution menus (where PLAN leaves latitude)

**How the snapshot carries variant bases (Phase 3.3):**
1. *(recommended)* `figures` map gains the base docs keyed by their refs + each variant keeps `baseFigureRef` pointing into it — client resolves. Obligation: worker snapshot test asserts bases present exactly once even when N variants share a base; contract (`packages/contract`) type updated in the same change.
2. Worker pre-resolves and returns merged timelines. **Rejected posture:** it duplicates domain resolution server-side and hides ownership from the client (the editor needs owned-vs-live per beat for badging, invariant #19). Only choose this with an explicit PLAN change.

**How the store resolves against a possibly-stale base (Phase 3.4):**
1. *(recommended, matches PLAN §6.2)* Snapshot-fresh base: resolve against the snapshot's base doc; the base's own WS opens only if an admin is editing it. Obligation: a store test pinning that a stale base never *overwrites* owned beats (staleness only affects unowned beats), and the "used in N" / badge reads stay correct.
2. Open a live WS to every placed variant's base. **Rejected posture:** violates D10's socket budget (viewers zero sockets; editors one routine WS + open-figure WS). Don't — this is the read-by-default alternative PLAN D10 already records as rejected.

**Where the variant-spawn decision lives (Phase 3.4b):**
1. *(recommended)* In the store's `editFigure` (as COW is today, routine.ts:1010) — client spawns, `POST /api/figures` projects with `baseFigureRef`, DO boundary still refuses non-admin writes to the global doc as defense-in-depth. Obligation: the rapid-double-edit guard (`cowInFlight` pattern) carries over; a routine-store test pins single-spawn under double edit.
2. Server-side spawn on rejected global write. **Rejected posture:** turns a sync-boundary refusal into a mutation, entangling the DO with registry writes; keep the DO's job pure.

## 7. Symptom → action while mid-campaign

| Symptom | Likely cause | Action |
|---|---|---|
| `resolveFigure` returns base data on a beat the variant owns | Ownership check not counting tombstoned attrs, or comparing sub-beat counts instead of `Math.floor` beats | You violated invariant #15 — read the per-beat ownership section of **ballroom-flow-crdt-reference**; the pin is fork.test.ts "the Passing Tumble Turn: base additions reach untouched beats only (§5.2)" |
| A beat's content "visually disappears" on first edit of an unowned beat | Copy-down (#16) skipped — the edit landed without materializing the base's current beat | Route the edit through `variantAttributesForEdit` with the full resolved timeline |
| Editing a variant changed the global doc (or vice versa) | A store write targeted the wrong `figureConn`, or the DO admin gate is missing | Invariant #17 violated — check which docRef the change frame went to; verify the DO refuses non-admin global writes |
| A v4 routine renders differently after your change | Back-compat broken — a full-timeline copy must resolve to exactly itself | Add/restore the v4-shape pin test before anything else (PLAN §9 back-compat note) |
| Automerge throws `Cannot set property ... undefined` | Wrote `undefined` into a doc | Use `stripUndefined` (`packages/domain/src/doc-internal.ts`); `null` is fine, `undefined` never |
| Worker test flakes across runs | Reused DO id under `isolatedStorage: false` | Unique id per test via `apps/worker/src/test-support/do-id.ts`; see **ballroom-flow-validation-and-qa** |
| Two-client E2E sees stale content after your catch-up change | "open" ≠ "hydrated" — client edits before `SYNC_CAUGHT_UP` applied | Re-read the hydration saga (97e7fea/4ef16ac) in **ballroom-flow-failure-archaeology** before patching |

## 8. Validation & promotion protocol

Success is **measured, never judged by eye** — route every phase exit through **ballroom-flow-change-control**. The concrete gates:

- **Named journeys:** `fork-and-figures.spec.ts` (variant + fork semantics), `library.spec.ts` (bookmark), `undo.spec.ts` (figure-editor undo), `convergence.spec.ts` (catch-up/resend). @smoke runs on every PR (`ci.yml`); full 3-project matrix nightly.
- **Invariant tests:** PLAN §2.5.1 #14–18 stay pinned in `packages/domain/src/fork.test.ts` + `convergence.test.ts`; any new store/worker resolution path gets its own back-compat pin (v4-shape figure resolves to itself).
- **EXPLAIN gates:** any new/changed D1 query proves no-table-SCAN via `apps/worker/src/test-support/explain.ts`.
- **Coverage ratchet:** thresholds are armed (domain lines 90, worker 88 as of 2026-07-02) — new code arrives tested or CI fails.
- **PR hygiene:** branch off `development`; PLAN §9 checkbox + TEST-MAP row flipped in the same PR; feature is "done" only when its journey is green on PR.

## Provenance and maintenance

Authored 2026-07-02 against repo HEAD `70eed7e` on `development`. All file:line claims, route paths, command outputs (domain suite: 227 passed / 3 skipped, re-run directly), and the DONE/OPEN audit were verified directly against that tree; PR/commit hashes (#83/#85, #107/38dfba7, #132/3725ec9/089dbc0/9edab0a/99fa1b9, e27bca6) come from git history. Issue numbers like #161/#168 are an internal ledger, not GitHub issues. Line numbers drift — re-anchor by symbol, not line.

Re-verify before relying on the audit:
```bash
grep -n -A 12 "v5 migration milestone" docs/PLAN.md | head -20     # milestone checkboxes
grep -n "frozen" apps/web/src/store/routine.ts | head              # store still frozen-style?
grep -rn "isAdmin\|routineCapOverride\|libraryFigureRefs" apps packages --include='*.ts' | grep -v test
grep -n "getAllChanges(current)" apps/worker/src/doc-do.ts         # catch-up still per-change?
grep -rn "migrate(" apps/worker/src --include='*.ts' | grep -v test # ladder wired yet?
grep -n "CURRENT_SCHEMA_VERSION" packages/domain/src/migrations.ts
pnpm --filter @ballroom/domain test                                 # current counts
```
