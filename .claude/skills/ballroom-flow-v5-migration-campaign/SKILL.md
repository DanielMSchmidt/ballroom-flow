---
name: ballroom-flow-v5-migration-campaign
description: Load when working on the v5 live-figure migration — the active engineering milestone (PLAN §9) — global figure docs, overlay/variant resolution in the web store, library-as-bookmark, admin seams, or the remaining hardening (figure-editor undo; the shipped sync hardening/migration-ladder/fork-v5 items are audited here too). Also load when a task mentions "variant", "spawnVariant", "resolveFigure", "frozen copy", "per-beat ownership", or the "Passing Tumble Turn".
---

# The v5 live-figure migration campaign

This is the executable runbook for finishing the v5 migration milestone (docs/PLAN.md §9, "v5 migration milestone", lines ~445–456). Work the phases in order; each has a gate you must observe passing before moving on.

**When NOT to use this:** for CRDT/Automerge concepts (per-beat ownership mechanics, undo internals, convergence testing) read **ballroom-flow-crdt-reference**; for the frozen module boundaries and locked decisions read **ballroom-flow-architecture-contract**; for how to run/test anything read **ballroom-flow-build-and-env** and **ballroom-flow-validation-and-qa**; for PR/TDD/PLAN-update doctrine read **ballroom-flow-change-control**; for debugging a failure you didn't cause read **ballroom-flow-debugging-playbook**; for seeding/charting figure content read **ballroom-flow-figure-data-pipeline**.

## 1. Mission context (read once)

- **v5 = live figures + per-beat overlay variants** (PLAN §5.2, §2.5.1 invariants #14–18). A placed catalog figure is a **live reference** to a global, admin-owned figure doc. A non-admin's first edit **spawns a variant**: an account figure whose `baseFigureRef` is a *live* link, carrying **only the beats it owns**; everything else resolves live from the base.
- **Canonical scenario (PLAN §5.2, line ~280):** a Slowfox choreo places the catalog *Tumble Turn* twice — one plain, one re-choreographed as a *Passing Tumble Turn* (last ~3 beats changed). When the catalog figure later gains new attribute values, the plain placement shows them everywhere; the Passing variant shows them **only on its untouched beats**.
- **Why frozen copies were retired:** the 2026-06-29 "frozen copy" model (PRs #97/#99/#100/#104) cut variants off from catalog improvements. PLAN v5.0 (PR #132, e27bca6/17eee40, 2026-07-02) reversed it after working the model against the Passing Tumble Turn scenario. Per-beat ownership is the precision the original v4 overlay lacked. Model history: live-overlay → frozen-copy → live-overlay-with-per-beat-ownership.
- **Back-compat guarantee (PLAN §9, line ~456): NO data migration.** A v4 frozen copy carries content on every beat it uses, so it **owns every such beat** (invariant #15) and `resolveFigure(base, copy)` returns exactly its current timeline. Its `baseFigureRef` becoming live changes nothing until the catalog adds values on beats the copy never touched. Existing catalog-seeded placements keep their account docs; **only new catalog adds become live references**.

## 2. Current-state audit (verified at HEAD 3693ff6, 2026-07-02)

| Item | State | Evidence |
|---|---|---|
| Domain v5 helpers (step 2) | ✅ DONE | `packages/domain/src/fork.ts`: `ownedBeats` :117, `resolveFigure` :132, `variantAttributesForEdit` :166, `spawnVariant` :205, `copyFigureForFork` :237. Tests: `fork.test.ts` "⟳v5 overlay variants (per-beat ownership)", Passing Tumble Turn scenario |
| Undo soundness (identity-anchored inverse, revert-at-most-once) | ✅ DONE | 3725ec9 (PR #132); `packages/domain/src/undo.ts`, `undo.test.ts` |
| `POST /api/figures` authorization (editor-of-routine required, no cross-owner upsert) | ✅ DONE | 089dbc0; `apps/worker/src/index.ts` |
| Non-destructive alarm projection (doc-derived identity) | ✅ DONE | 9edab0a; `apps/worker/src/doc-do.ts` alarm/`projectToD1` :914 |
| Post-connect role re-enforcement + annotation authorship | ✅ DONE | 99fa1b9; `doc-do.ts` `refreshConnectedRoles` :626 |
| Snapshot-frame catch-up | ✅ DONE | PR #134 (84c3eea…054d91e). Connect catch-up = ONE `SYNC_FRAME_SNAPSHOT` binary frame (an `A.save` blob) + `SYNC_CAUGHT_UP` (`doc-do.ts` :489–510); the client `A.load`s and **`A.merge`s** it so unacked local edits survive (`doc-connection.ts` `mergeSnapshot` :385). Server→client binary frames now carry a 1-byte type tag (`SYNC_FRAME_SNAPSHOT`/`SYNC_FRAME_CHANGE`, contract :174–175); client→server frames stay raw change bytes. **Hard protocol cutover** — old client ⇄ new server drops frames until reload (accepted; a WS-subprotocol version is the recorded escape hatch) |
| Reconnect resend of unacked local changes (#161) | ✅ DONE | PR #134. After merging the snapshot, the client diffs `A.getChanges(serverDoc, merged)` and resends what the server lacks (`doc-connection.ts` :399–406, `resendMissing` :424); the unseeded-doc case resends `getAllChanges` at `SYNC_CAUGHT_UP` (:354). Idempotent server-side (`ingestChange` dedupes via heads) |
| Broadcast-send failure → resync | ✅ DONE | PR #134. A failed `broadcast` send **closes the socket** with `SYNC_RESYNC_CLOSE_CODE` (4001) (`doc-do.ts` :709–728); the client treats it as a warm drop, auto-reconnects, and pulls a fresh snapshot |
| Migration ladder on DO load path + stamp fresh docs | ✅ DONE | PR #135 (eee3f5b, 8146621, 2fc7371). `doc-do.ts` `loadPersisted` :194 → `migrateOnLoad` :240 runs `migrateDraft` inside an `A.change` attributed to the fixed `MIGRATION_ACTOR` :132 (never a user's, so per-user undo can't select it) and persists the upgrade; every seed site stamps `CURRENT_SCHEMA_VERSION` (`starter-routine.ts`, `doc-do.ts` `emptyRoutine` :118, worker `index.ts`, `sample.ts`, `routes/test-seed.ts`, web store `routine.ts` :385 + `routine-snapshot.ts` :70). **⚠ but see the incident box below — the load-path fix (PR #140) is pending** |
| Figure-editor undo targets the figure doc | ☐ OPEN | `apps/web/src/store/routine.ts` `undo()` :972 / `redo()` :985 commit to `routineConn` only |
| Step 3: global figure docs + store rewiring | ☐ OPEN | No production path creates a global-scope figure doc (`type='global-figure'` registry rows are written only by `routes/test-seed.ts` :181); store `resolveFigure` :1117 is frozen-style ("no live overlay against a base", :1116); `editFigure` :1012 still calls legacy `copyOnWrite` :1035; worker snapshot route (`index.ts` :750, :769–770) mirrors frozen-style |
| Step 4: library-as-bookmark | ☐ OPEN | `libraryFigureRefs` appears nowhere in `packages/` or `apps/` source |
| Step 5: fork v5 (copy account figures) | ✅ DONE | PR #133 (8cb646c, 0e65912). `POST /api/routines/:id/fork` (`apps/worker/src/fork.ts` `forkRoutineFor` :40) re-points every placement whose `figureRef` resolves to a registry `type='account-figure'` at a fresh `copyFigureForFork` copy owned by the forker — minted, D1-projected via `createFigureRows`, and DO-seeded **before** the fork's routine doc is seeded (never post-hoc CRDT surgery), with a `placement_edge` per copy. Global-figure refs, dangling/unregistered refs, and app-owned template figures stay untouched (live). A collision with `account_figure_base_idx` (one account-figure per `(owner, base)`, migration 0010) reuses the forker's existing derivative. Pinned by `routes/fork.test.ts` "v5 fork" |
| Step 6: admin seams | ☐ OPEN | `isAdmin` / `routineCapOverride` appear nowhere in source; 13 D1 migrations exist (0001–0013) |

> **⚠ INCIDENT (2026-07-02, OPEN until PR #140 merges): migrateOnLoad lineage divergence.**
> The #133/#135 interaction left `development`'s tip **red**: `routes/fork.test.ts` "is
> independent of the origin" fails deterministically (each PR was green on its own merge ref).
> Root cause: `migrateOnLoad` persists the migration change even during **transient reads**
> (`getFigureSnapshot` :429 and the connect catch-up call `loadPersisted` directly, not
> `getDoc`), but the instance's already-materialized `this.doc` never applies it — the
> persisted change log and the live doc diverge into different lineages. A peer change built
> on the persisted heads then arrives at `ingestChange` with a missing dep; Automerge defers
> it, heads stay unchanged, and it is silently swallowed as a "duplicate" (`applyRawChange`
> returns false). Fix (PR #140, branch `fix/migrate-on-load-live-doc`, 601032a): after
> persisting the migration change, advance `this.doc` with it too — **the change log must
> never contain a change the live doc hasn't applied.** Lesson for anyone touching the load
> path: every read that can persist must also advance the in-memory doc; this is recurring
> pattern 2 ("open ≠ hydrated ≠ durable" — state written on one path another path never
> observes) in **ballroom-flow-failure-archaeology**. Check `git log origin/development
> --oneline -5` — if #140 has merged, flip this box to FIXED.

Re-audit before starting — later sessions may have landed some of these (see Provenance).

## 3. Standing orders for every phase

- **TDD.** Write/extend the failing test first (RED), implement (GREEN), refactor. See **ballroom-flow-change-control** for the full doctrine.
- **Branch off `development`** (never `main` — the #83/#85 revert cost ~1269 lines). PR back into `development`.
- **PLAN.md moves with the code:** flip the matching §9 checkbox and reconcile any superseded prose (and docs/TEST-MAP.md rows) **in the same PR**. Divergence between PLAN and code is a bug.
- Commands (from repo root; package filters are `@ballroom/domain`, `worker`, `web`):

```bash
pnpm --filter @ballroom/domain test   # 232 passed / 3 skipped at 3693ff6, ~5s
pnpm --filter worker test             # at 3693ff6: 161 passed / 1 FAILED / 7 skipped — fork.test.ts
                                      #   "is independent of the origin" fails DETERMINISTICALLY
                                      #   (the migrateOnLoad incident, §2); 162 passed / 7 skipped
                                      #   once PR #140 lands. ~55s. (Under heavy sandbox load
                                      #   starter.test.ts can also hit its 5s timeout — environmental,
                                      #   passes in isolation.)
pnpm --filter web test                # 333 passed at 3693ff6
pnpm lint && pnpm typecheck           # both must be clean before commit (lefthook enforces)
pnpm test:e2e:smoke                   # Playwright @smoke; in sandboxes add --project=chromium-desktop
```

- Worker/DO tests: `isolatedStorage: false` — every test needs a **unique DO id** (`apps/worker/src/test-support/do-id.ts`). D1 query shape changes go through the EXPLAIN no-SCAN gate (`apps/worker/src/test-support/explain.ts`).

## 4. Phases (PLAN §9 sequence — hardening first, no model change; then steps 3→6)

### Phase 0 — Preflight (every session)

```bash
git branch --show-current                       # must be a feature branch off development
grep -n -A 12 "v5 migration milestone" docs/PLAN.md | head -20   # which boxes are already flipped?
git log origin/development --oneline -5         # has PR #140 (migrateOnLoad live-doc fix) merged?
pnpm --filter @ballroom/domain test             # baseline green before you touch anything
```

Read PLAN §5.2 (lines ~278–288) and §2.5.1 #14–20 (lines ~143–151) in full — every phase below cites them by invariant number. Then pick the **first unflipped box** in §9's order; do not start step 3 while a step-1 box is open (the sequence exists to keep the suite green throughout).

### Phases 1a / 1a′ / 1b — ✅ SHIPPED (verify, don't rebuild)

Snapshot-frame catch-up + reconnect resend + broadcast-failure resync landed as **PR #134**
(84c3eea…054d91e); the migration ladder on the DO load path + `CURRENT_SCHEMA_VERSION`
stamping landed as **PR #135** (eee3f5b, 8146621, 2fc7371). Details and evidence in the §2
audit table; the new wire protocol is documented in **ballroom-flow-crdt-reference** §7.
One piece of it is still in flight: the **migrateOnLoad lineage-divergence fix (PR #140)** —
see the §2 incident box before touching `loadPersisted`/`migrateOnLoad`/`ingestChange`.
Ladder rules that remain binding: if you bump `CURRENT_SCHEMA_VERSION` for v5 shapes later,
that is a **new** ladder step — never edit an existing one; identity fields `figureType`/`dance`
are immutable through migration (`IMMUTABLE_IDENTITY_FIELDS`, migrations.ts).

### Phase 1c — Figure-editor undo targets the figure doc (the remaining step-1 box)

**Entry state:** `routine.ts` `undo()`/`redo()` (:972/:985) always commit to `routineConn`. PLAN §5.4 (LOCKED): "undo follows the surface being edited" — the figure editor's no-Save contract is only honest if figure edits are undoable there.
**TDD entry:** `apps/web/src/store/routine-store.test.ts` — after `setFigureAttributes` on an open figure, `undo()` must revert the **figure doc**, not the routine's last change. Then extend `apps/web/e2e/undo.spec.ts` (@smoke) with a figure-editor undo journey.
**Solution latitude:** (i) `undo(target?: { figureRef })` parameter chosen by the active surface, or (ii) the store tracks the "active editing surface" and routes `undo()`. Either way `wasSupersededByOthers` must peek the doc being undone.
**Gate:** web suite green; `pnpm test:e2e:smoke` green including the new journey.
**Exit:** flip the PLAN §9 step 1 undo box.

### Phase 2 — Domain v5 helpers (✅ done — verify, don't rebuild)

Run `pnpm --filter @ballroom/domain test`. Expect 232+ passing (as of 2026-07-02, HEAD 3693ff6), including the fork.test.ts Passing Tumble Turn scenario. If `resolveFigure` ever returns base data on a beat the variant owns, you violated invariant #15 — stop and read the per-beat ownership section of **ballroom-flow-crdt-reference** before touching fork.ts.

### Phase 3 — Global figure docs + THE STORE REWIRING (the crux)

**Entry state:** catalog placements are seeded as account docs from the bundled `LIBRARY_FIGURES` (routine.ts `addPlacement`); global-figure registry rows exist only in tests; `editFigure` :1012 forks a frozen copy via `copyOnWrite`; store `resolveFigure` :1117 and the worker snapshot (index.ts :750, :769–770) do no base resolution.

Sub-steps, each TDD'd, sequenced to keep the suite green:

1. **Additive seeder into real global docs (D30).** Import bundled catalog figures into per-figure DOs + `document_registry` rows (`type='global-figure'`, app-owned). **Additive-only:** a doc that exists is never overwritten — the doc is the source of truth after import; re-runs only add missing figures. TDD in a new `apps/worker/src/` test using `seedDoc` (no-clobber already built, doc-do.ts:282) + unique DO ids. Ref format precedent: `globalFigureRef(dance, figureType)` = `global:<dance>:<figureType>` (`packages/domain/src/library.ts` :97).
2. **Admin read/write boundary.** Global figure docs: all authenticated users read; only admins write (PLAN §6). Enforce in the DO's role resolution (extend `resolveEffectiveRole` / the DO fetch gate, doc-do.ts `fetch` :444) — **never** by post-hoc change rejection alone; the effect-based classifier (`commenterChangeAllowed`, doc-do.ts:567) is the pattern if a finer gate is needed. Depends on Phase 6's `isAdmin` column *or* stub it read-only-for-all until Phase 6 lands (all-read/no-write is safe and unblocks the rest).
3. **Snapshot returns variant bases.** `GET /api/routines/:id/snapshot` (index.ts:750) must also fetch each variant's `baseFigureRef` doc and return it (PLAN §6.2: "routine + placed figures + variant bases, resolved per-beat client-side"). TDD in `apps/worker/src/` snapshot tests.
4. **Store rewiring.** (a) New catalog adds become live references (placement's `figureRef` = the global doc ref; no account doc minted). (b) `editFigure` on a `scope === "global"` figure switches from `copyOnWrite` → `spawnVariant` + `variantAttributesForEdit` (edit the *resolved* timeline, hand the whole intended content to `variantAttributesForEdit`). (c) Store `resolveFigure` :1117 resolves a variant against its (possibly snapshot-stale) base via domain `resolveFigure`. TDD in `routine-store.test.ts` (the existing COW cases are your template — rewrite them to the variant semantics, don't delete them).
5. **Reconcile the journeys + docs in the same PR(s):** `apps/web/e2e/fork-and-figures.spec.ts` :154 currently asserts "editing a GLOBAL figure auto-creates your frozen copy" — rewrite to variant semantics (edited beats owned, untouched beats live). Update TEST-MAP.md rows US-035/US-036 (both still record the frozen reconciliation). Do NOT "fix" PLAN §12's older frozen-model Q-entries — they are deliberately retained for lineage under the "Resolved 2026-07-02 (the v5 reversal — supersedes …)" header.

**Gate observations:** `pnpm --filter @ballroom/domain test` → 232+N passing; `pnpm --filter web test` green with zero remaining assertions of "frozen snapshot, no overlay"; `pnpm test:e2e:smoke` green including the rewritten fork-and-figures journey; back-compat pinned by a test where a full-timeline account figure (v4 copy shape) resolves to exactly its own timeline against any base.
**Exit:** flip PLAN §9 step 3; `copyOnWrite` remains in fork.ts read-only for legacy data (do not delete it in this phase).

### Phase 4 — Library-as-bookmark

**Entry state:** `POST /api/figures/save-to-library` (index.ts:417) mints an idempotent account **copy**; account doc has no `libraryFigureRefs`.
**TDD entry:** domain `doc-account.test.ts` (add/remove bookmark, un-bookmark never deletes the doc — PLAN §5.2); worker tests for the bookmark route + `LibraryEntry` projection; component test for the "add to my library" affordance. Note `packages/domain/src/doc-account.ts` is built but **not yet wired to a DO** — wiring the account doc is part of this phase's worker work.
**Gate:** `apps/web/e2e/library.spec.ts` (@smoke) green on the bookmark semantics (two users bookmarking the same shared figure → one doc, no copy).
**Exit:** flip PLAN §9 step 4; `save-to-library` semantics change is reconciled in TEST-MAP.

### Phase 5 — Fork v5 (✅ SHIPPED — PR #133)

Landed 2026-07-02 (8cb646c, 0e65912; PLAN §9 step 5 is ✅). Semantics and evidence in the §2
audit table; pinned by `apps/worker/src/routes/fork.test.ts` "v5 fork". **Note:** its
"is independent of the origin" test is the one currently red on `development`'s tip — that is
the migrateOnLoad incident (§2 box), not a fork-semantics bug; do not "fix" fork.ts for it.

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
1. *(recommended)* In the store's `editFigure` (as COW is today, routine.ts:1012) — client spawns, `POST /api/figures` projects with `baseFigureRef`, DO boundary still refuses non-admin writes to the global doc as defense-in-depth. Obligation: the rapid-double-edit guard (`cowInFlight` pattern) carries over; a routine-store test pins single-spawn under double edit.
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
| A peer/RPC change is silently ignored — `applyRawChange`/`ingestChange` returns false, heads unchanged | Live-doc vs persisted-lineage divergence (the migrateOnLoad incident, §2) | Diff the persisted change log against `A.getAllChanges(this.doc)`; see the §2 incident box + **ballroom-flow-debugging-playbook** row 12 |

## 8. Validation & promotion protocol

Success is **measured, never judged by eye** — route every phase exit through **ballroom-flow-change-control**. The concrete gates:

- **Named journeys:** `fork-and-figures.spec.ts` (variant + fork semantics), `library.spec.ts` (bookmark), `undo.spec.ts` (figure-editor undo), `convergence.spec.ts` (catch-up/resend). @smoke runs on every PR (`ci.yml`); full 3-project matrix nightly.
- **Invariant tests:** PLAN §2.5.1 #14–18 stay pinned in `packages/domain/src/fork.test.ts` + `convergence.test.ts`; any new store/worker resolution path gets its own back-compat pin (v4-shape figure resolves to itself).
- **EXPLAIN gates:** any new/changed D1 query proves no-table-SCAN via `apps/worker/src/test-support/explain.ts`.
- **Coverage ratchet:** thresholds are armed (domain lines 90, worker 88 as of 2026-07-02) — new code arrives tested or CI fails.
- **PR hygiene:** branch off `development`; PLAN §9 checkbox + TEST-MAP row flipped in the same PR; feature is "done" only when its journey is green on PR.

## Provenance and maintenance

Authored 2026-07-02 against repo HEAD `70eed7e`; **refreshed 2026-07-02 against HEAD `3693ff6`**
(after PRs #133 v5-fork-copy, #134 sync-hardening, #135 migration-ladder-wiring) on
`development`. All file:line claims, route paths, command outputs (domain 232/3 skipped,
worker 161 passed + 1 failed + 7 skipped, web 333 — re-run directly), and the DONE/OPEN audit
were verified directly against that tree; PR/commit hashes (#83/#85, #107/38dfba7,
#132/3725ec9/089dbc0/9edab0a/99fa1b9, e27bca6, #133/8cb646c/0e65912, #134/84c3eea…054d91e,
#135/eee3f5b/8146621/2fc7371) come from git history. **PR #140** (601032a, branch
`fix/migrate-on-load-live-doc` — the migrateOnLoad incident fix) was **NOT yet merged** at
refresh time; re-check its status first. Issue numbers like #161/#168 are an internal ledger,
not GitHub issues. Line numbers drift — re-anchor by symbol, not line.

Re-verify before relying on the audit:
```bash
git log origin/development --oneline -5                            # PR #140 merged yet?
grep -n -A 12 "v5 migration milestone" docs/PLAN.md | head -20     # milestone checkboxes
grep -n "frozen" apps/web/src/store/routine.ts | head              # store still frozen-style?
grep -rn "isAdmin\|routineCapOverride\|libraryFigureRefs" apps packages --include='*.ts' | grep -v test
grep -n "SYNC_FRAME_SNAPSHOT" apps/worker/src/doc-do.ts            # snapshot catch-up in place
grep -n "migrateOnLoad" apps/worker/src/doc-do.ts                  # ladder on the load path
grep -n "CURRENT_SCHEMA_VERSION" packages/domain/src/migrations.ts
pnpm --filter @ballroom/domain test                                 # current counts
```
