---
name: ballroom-flow-v5-migration-campaign
description: Load when working on or building atop the v5 live-figure migration (PLAN §9) — COMPLETE as of 2026-07-02 (HEAD 759b3a8) — global figure docs, overlay/variant resolution in the web store, library-as-bookmark, admin seams, figure-scoped undo, or verifying the shipped steps still hold. Also load when a task mentions "variant", "spawnVariant", "resolveFigure", "frozen copy", "per-beat ownership", or the "Passing Tumble Turn".
---

# The v5 live-figure migration campaign

**Status (2026-07-02, HEAD `759b3a8`): the milestone is COMPLETE — zero `☐` boxes left in
PLAN §9.** The final box (figure-editor undo targets the figure doc, §5.4) shipped in PR #141
(`e14c5cb` store `undoFigure`/`redoFigure` + `d9072a8` editor-header affordance) minutes after
the rest; steps 1–6 are ✅ (PRs #132–#137, #139, #141). This skill is now (a) the verification
protocol for the shipped phases, (b) the audit of what shipped where, and (c) the fence around
the wrong paths. The tracked follow-up tail (security comments, perf, a11y, sortKey
convergence, reconnect) lives in the task board, folded into the feature whose journey each
item serves (CLAUDE.md §6).

**When NOT to use this:** for CRDT/Automerge concepts (per-beat ownership mechanics, undo internals, convergence testing) read **ballroom-flow-crdt-reference**; for the frozen module boundaries and locked decisions read **ballroom-flow-architecture-contract**; for how to run/test anything read **ballroom-flow-build-and-env** and **ballroom-flow-validation-and-qa**; for PR/TDD/PLAN-update doctrine read **ballroom-flow-change-control**; for debugging a failure you didn't cause read **ballroom-flow-debugging-playbook**; for seeding/charting figure content read **ballroom-flow-figure-data-pipeline**.

## 1. Mission context (read once)

- **v5 = live figures + per-beat overlay variants** (PLAN §5.2, §2.5.1 invariants #14–18). A placed catalog figure is a **live reference** to a global, admin-owned figure doc. A non-admin's first edit **spawns a variant**: an account figure whose `baseFigureRef` is a *live* link, carrying **only the beats it owns**; everything else resolves live from the base.
- **Canonical scenario (PLAN §5.2, line ~280):** a Slowfox choreo places the catalog *Tumble Turn* twice — one plain, one re-choreographed as a *Passing Tumble Turn* (last ~3 beats changed). When the catalog figure later gains new attribute values, the plain placement shows them everywhere; the Passing variant shows them **only on its untouched beats**.
- **Why frozen copies were retired:** the 2026-06-29 "frozen copy" model (PRs #97/#99/#100/#104) cut variants off from catalog improvements. PLAN v5.0 (PR #132, e27bca6/17eee40, 2026-07-02) reversed it after working the model against the Passing Tumble Turn scenario. Per-beat ownership is the precision the original v4 overlay lacked. Model history: live-overlay → frozen-copy → live-overlay-with-per-beat-ownership.
- **Back-compat guarantee (PLAN §9, line ~456): NO data migration.** A v4 frozen copy carries content on every beat it uses, so it **owns every such beat** (invariant #15) and `resolveFigure(base, copy)` returns exactly its current timeline. Its `baseFigureRef` becoming live changes nothing until the catalog adds values on beats the copy never touched. Existing catalog-seeded placements keep their account docs; **only new catalog adds become live references**.

## 2. Current-state audit (verified at HEAD 759b3a8, 2026-07-02)

PLAN §9 (lines ~445–456) carries the authoritative per-step detail — this table is the
pointer map. All line anchors re-verified at this HEAD; they drift, re-anchor by symbol.

| Item | State | Evidence |
|---|---|---|
| Domain v5 helpers (step 2) | ✅ DONE | `packages/domain/src/fork.ts`: `ownedBeats` :117, `resolveFigure` :132, `variantAttributesForEdit` :166, `spawnVariant` :205, `copyFigureForFork` :237 (`copyOnWrite` :72 retained, legacy-read-only). Tests: `fork.test.ts` "⟳v5 overlay variants (per-beat ownership)", Passing Tumble Turn scenario |
| Undo soundness (identity-anchored inverse, revert-at-most-once) | ✅ DONE | 3725ec9 (PR #132); `packages/domain/src/undo.ts`, `undo.test.ts` |
| `POST /api/figures` authorization (editor-of-routine required, no cross-owner upsert) | ✅ DONE | 089dbc0; `apps/worker/src/index.ts` |
| Non-destructive alarm projection (doc-derived identity) | ✅ DONE | 9edab0a; `apps/worker/src/doc-do.ts` alarm/`projectToD1` :926 |
| Post-connect role re-enforcement + annotation authorship | ✅ DONE | 99fa1b9; `doc-do.ts` `refreshConnectedRoles` :638 |
| Snapshot-frame catch-up | ✅ DONE | PR #134 (84c3eea…054d91e). Connect catch-up = ONE `SYNC_FRAME_SNAPSHOT` binary frame (an `A.save` blob) + `SYNC_CAUGHT_UP` (`doc-do.ts` :511–522); the client `A.load`s and **`A.merge`s** it so unacked local edits survive (`doc-connection.ts` `mergeSnapshot` :385). Server→client binary frames carry a 1-byte type tag (`SYNC_FRAME_SNAPSHOT`/`SYNC_FRAME_CHANGE`, contract :183–184); client→server frames stay raw change bytes. **Hard protocol cutover** — old client ⇄ new server drops frames until reload (accepted; a WS-subprotocol version is the recorded escape hatch) |
| Reconnect resend of unacked local changes (#161) | ✅ DONE | PR #134. After merging the snapshot, the client diffs `A.getChanges(serverDoc, merged)` and resends what the server lacks (`doc-connection.ts` :399–406, `resendMissing` :424); the unseeded-doc case resends `getAllChanges` at `SYNC_CAUGHT_UP` (:354). Idempotent server-side (`ingestChange` dedupes via heads) |
| Broadcast-send failure → resync | ✅ DONE | PR #134. A failed `broadcast` send **closes the socket** with `SYNC_RESYNC_CLOSE_CODE` (4001) (`doc-do.ts` `broadcast` :721); the client treats it as a warm drop, auto-reconnects, and pulls a fresh snapshot |
| Migration ladder on DO load path + stamp fresh docs | ✅ DONE | PR #135 (eee3f5b, 8146621, 2fc7371) **+ the lineage fix, PR #139 (903d109)** — see the incident box. `doc-do.ts` `loadPersisted` :195 → `migrateOnLoad` :241 runs `migrateDraft` inside an `A.change` attributed to the fixed `MIGRATION_ACTOR` :133 (never a user's, so per-user undo can't select it), persists the upgrade, and **adopts the migrated doc** (`this.doc = fresh`, :265); every seed site stamps `CURRENT_SCHEMA_VERSION` |
| **Figure-editor undo targets the figure doc** | ✅ PR #141 (`e14c5cb`, `d9072a8`) | `apps/web/src/store/routine.ts` `undoFigure` :260/:1025 inverts this tab's actor's last change on the FIGURE's own `DocConnection` (figure conns seed with the per-tab actor so figure edits are attributable); editor header carries Undo/Redo (surface-follows-focus, §5.4) |
| Step 3: global figure docs + store rewiring | ✅ DONE | PR #137 (71b7aa2, 1e71cec, 6c371b8, 26e8e8b, 3b50802, 60bfb70; merge c9622c9). Additive **idempotent** `seedGlobalFigures` seeder into real admin-owned docs (`apps/worker/src/seed-global-figures.ts`), exposed as admin-only `POST /api/admin/seed-global-figures` (index.ts :323) + reused from the E2E test-seed path; `resolveEffectiveRole` global-figure boundary (any user → viewer, admin → editor; `db/membership.ts` :81); catalog placements are **LIVE references** (`addPlacement` → `globalFigureRef`, no POST — routine.ts :797); the snapshot fans out variant **bases** (index.ts :751–802); the store's edit-global path is `spawnVariant` + per-beat overlay resolution on read (routine.ts `spawnVariantForEdit` :1068, `resolveFigure` :1218 → domain `resolveVariantOverlay` :1233, base via `resolveBaseContent` :1165: open live conn → snapshot → bundled catalog). Editing an ACCOUNT variant also routes through `variantAttributesForEdit`, so reverting a beat to base content releases ownership. A catalog live-reference is editor-ready without its own socket (3b50802) |
| Step 4: library-as-bookmark | ✅ DONE | PR #136 (ed59aa9, 315c819, f83883f, 7962b93, f4aef0e; merge b910dc0). Account-doc `libraryFigureRefs` (`packages/domain/src/doc-account.ts` `addLibraryRef` :58 / `removeLibraryRef` :71) + `library_entry` D1 projection (migration 0015, `apps/worker/src/db/library.ts`). `POST /api/figures/save-to-library` is a **bookmark** — accepts `{ figureRef }` or the legacy `(dance, figureType, name)` triple (resolved to `globalFigureRef`, no copy), auth-gated on `resolveEffectiveRole`; DELETE un-bookmarks (tombstone); `GET /api/figures/mine` is bookmark-driven (`listMineFigures`); "add to my library" affordance in Assemble + FigureTimeline. **Nuance (PLAN §9 step 4 says this explicitly):** the account doc is STILL not wired to a live DO — `library_entry` is the persisted state today; the CRDT helpers are the intended home once that wiring lands |
| Step 5: fork v5 (copy account figures) | ✅ DONE | PR #133 (8cb646c, 0e65912). `POST /api/routines/:id/fork` (`apps/worker/src/fork.ts` `forkRoutineFor`) re-points every placement whose `figureRef` resolves to a registry `type='account-figure'` at a fresh `copyFigureForFork` copy owned by the forker — minted, D1-projected via `createFigureRows`, and DO-seeded **before** the fork's routine doc is seeded (never post-hoc CRDT surgery), with a `placement_edge` per copy. Global-figure refs, dangling/unregistered refs, and app-owned template figures stay untouched (live). A collision with `account_figure_base_idx` (one account-figure per `(owner, base)`, migration 0010) reuses the forker's existing derivative. Pinned by `routes/fork.test.ts` "v5 fork" |
| Step 6: admin seams (D31) | ✅ DONE | PR #137 (71b7aa2). `isAdmin` + `routineCapOverride` columns on `users` (migration 0014); the quota seam `routineCapFor` (`apps/worker/src/db/admin.ts`) reads the override before the plan default on **both** routine-create and fork; `/api/me` surfaces the effective cap + admin flag (index.ts :124–136). Elevation remains an ops action (queue UI v1.1) — see **ballroom-flow-run-and-operate** §7 |

> **✅ INCIDENT RESOLVED (2026-07-02): migrateOnLoad lineage divergence — FIXED by PR #139
> (903d109, merged as 8ddd147).** The #133/#135 interaction had left `development`'s tip red:
> `routes/fork.test.ts` "is independent of the origin" failed deterministically. Root cause:
> `migrateOnLoad` persisted the migration change even during **transient reads**
> (`getFigureSnapshot` and the connect catch-up call `loadPersisted` directly, not `getDoc`),
> but the instance's already-materialized `this.doc` never applied it — the persisted change
> log and the live doc diverged into different lineages; a peer change built on the persisted
> heads was silently swallowed by `ingestChange` as a "duplicate" (missing dep → heads
> unchanged). The fix: `migrateOnLoad` now **adopts the migrated clone wholesale**
> (`this.doc = fresh`, doc-do.ts :265) — monotonically safe because every ingested change is
> persisted immediately, so `this.doc` is always a prefix of what SQLite replays. (Two
> sessions root-caused it independently; the identical fix in PR #140/601032a was closed as
> superseded by #139.) Standing lesson for anyone touching the load path: **the change log
> must never contain a change the live doc hasn't applied** — recurring pattern 2 in
> **ballroom-flow-failure-archaeology**; triage row 12 in **ballroom-flow-debugging-playbook**.

Re-audit before relying on this — later sessions may have moved things (see Provenance).

## 3. Standing orders for every phase

- **TDD.** Write/extend the failing test first (RED), implement (GREEN), refactor. See **ballroom-flow-change-control** for the full doctrine.
- **Branch off `development`** (never `main` — the #83/#85 revert cost ~1269 lines). PR back into `development`.
- **PLAN.md moves with the code:** flip the matching §9 checkbox and reconcile any superseded prose (and docs/TEST-MAP.md rows) **in the same PR**. Divergence between PLAN and code is a bug.
- Commands (from repo root; package filters are `@ballroom/domain`, `worker`, `web`):

```bash
pnpm --filter @ballroom/domain test   # 245 passed / 3 skipped at c9622c9, ~5s
pnpm --filter worker test             # 180 passed / 7 skipped at c9622c9 — GREEN (the migrateOnLoad
                                      #   incident is fixed, §2). ~55s. (Under heavy sandbox load
                                      #   starter.test.ts can hit its 5s timeout — environmental,
                                      #   passes in isolation.)
pnpm --filter web test                # 343 passed at c9622c9
pnpm lint && pnpm typecheck           # both must be clean before commit (lefthook enforces)
pnpm test:e2e:smoke                   # Playwright @smoke; in sandboxes add --project=chromium-desktop
```

- Worker/DO tests: `isolatedStorage: false` — every test needs a **unique DO id** (`apps/worker/src/test-support/do-id.ts`). D1 query shape changes go through the EXPLAIN no-SCAN gate (`apps/worker/src/test-support/explain.ts`).

## 4. Verification protocol (the milestone is shipped — verify, don't rebuild)

### Phase 0 — Preflight (every session)

```bash
git branch --show-current                       # must be a feature branch off development
grep -n '☐' docs/PLAN.md                        # ZERO boxes at 759b3a8 — any hit means new milestone work opened after this skill
pnpm --filter @ballroom/domain test             # baseline green before you touch anything
```

Read PLAN §5.2 (lines ~278–288), §5.4 (~:295–298), and §2.5.1 #14–20 in full.

### How the last box shipped (PR #141 — for anyone touching undo next)

PLAN §5.4 (LOCKED): "**Undo follows the surface being edited**: in the Assemble view it
targets the routine doc; inside the figure editor it targets **that figure's doc**" — the
figure editor's auto-save/no-Save contract (§4.4) is only honest because figure edits are
undoable there. PR #141 solved the routing with **dedicated store methods**, not a mode
switch: `undoFigure(figureRef)`/`redoFigure(figureRef)` (`routine.ts` :260/:1025) invert
this tab's actor's last change on the **figure's own** `DocConnection`; each figure
connection now seeds with the same per-tab actor so figure edits are attributable and
undoable; the full-screen editor header carries the affordance (`d9072a8`). Routine-level
`undo()`/`redo()` still target the routine doc. D14's soundness rules (identity-anchored
inverse, revert-at-most-once — `packages/domain/src/undo.ts`) apply unchanged to both
surfaces. If you extend undo further, keep the surface-follows-focus rule and the
`wasSupersededByOthers` pre-undo peek.

### Shipped phases — verification protocol

Before building on any shipped step, prove it still holds — each has a named pin:

| Shipped item | How to prove it still holds |
|---|---|
| Domain v5 helpers + back-compat (step 2) | `pnpm --filter @ballroom/domain test` — expect 245+/3 skipped, incl. fork.test.ts "the Passing Tumble Turn: base additions reach untouched beats only (§5.2)" and the §9 back-compat pin "legacy full copy resolves to its own content" (30d6868) |
| Sync hardening (PR #134) + migration ladder (PR #135 + #139) | `pnpm --filter worker test` — expect 180/7 skipped GREEN (fork.test.ts "is independent of the origin" passing IS the lineage-fix pin); `grep -n "this.doc = fresh" apps/worker/src/doc-do.ts` (the #139 adopt) |
| Global docs + store rewiring (step 3) | worker: seeder + boundary + snapshot-bases tests (`seed-global-figures`/`snapshot`/`access` suites); web: `routine-store.test.ts` variant-spawn + overlay-resolution cases; E2E `fork-and-figures.spec.ts` @smoke variant journey (its US-035 test *name* still says "frozen copy" — the intent comment and assertions are variant semantics; a rename is cosmetic follow-up) |
| Library-as-bookmark (step 4) | domain `doc-account.test.ts`; worker bookmark-route tests; `assemble.test.tsx` / `figure-timeline-beats.test.tsx` "add to my library" cases; E2E `library.spec.ts` @smoke |
| Fork v5 (step 5) | `routes/fork.test.ts` "v5 fork" |
| Admin seams (step 6) | worker quota tests (create + fork read `routineCapFor`); `/api/me` shape in `routes/me-profile.test.ts` region; EXPLAIN gate clean |
| Figure-editor undo (PR #141) | web: `routine-store.test.ts` figure-undo cases (`pnpm --filter web test` — 355 passed at 759b3a8); E2E `undo.spec.ts` |

Ladder rules that remain binding: if you bump `CURRENT_SCHEMA_VERSION` for new shapes,
that is a **new** ladder step — never edit an existing one; identity fields
`figureType`/`dance` are immutable through migration (`IMMUTABLE_IDENTITY_FIELDS`,
migrations.ts). And any change to `loadPersisted`/`migrateOnLoad`/`ingestChange` must
preserve the #139 invariant: **the change log never contains a change the live doc hasn't
applied.**

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

## 6. As-built decisions (PR #137 chose the recommended option in each menu)

Recorded so nobody re-opens them without a new scenario; the rejected postures stand rejected:

- **Snapshot carries variant bases as separate docs, client resolves.** `GET
  /api/routines/:id/snapshot` returns `{ routine, figures, bases }` — each distinct
  `baseFigureRef` doc exactly once (index.ts :751–802); the contract type shipped in the same
  change. *Rejected:* worker pre-resolving merged timelines (duplicates domain resolution
  server-side; hides owned-vs-live per beat, which the editor needs for badging, invariant #19).
- **Store resolves against a possibly-stale base, snapshot-fresh.** `resolveBaseContent`
  (routine.ts :1165) reads an OPEN live base connection first, else the snapshot's base doc,
  else the bundled catalog for a `global:` ref; a stale base can only affect **unowned** beats
  (owned beats read wholly from the variant — invariant #15). *Rejected:* opening a live WS to
  every placed variant's base (violates D10's socket budget).
- **The variant-spawn decision lives in the store's `editFigure`** (routine.ts :1035 →
  `spawnVariantForEdit` :1068) — client spawns, `POST /api/figures` projects with
  `baseFigureRef`, and the DO boundary still refuses non-admin global writes as
  defense-in-depth (`resolveEffectiveRole`'s global-figure branch). *Rejected:* server-side
  spawn on a rejected global write (turns a sync-boundary refusal into a mutation).

## 7. Symptom → action when touching the v5 surfaces

| Symptom | Likely cause | Action |
|---|---|---|
| `resolveFigure` returns base data on a beat the variant owns | Ownership check not counting tombstoned attrs, or comparing sub-beat counts instead of `Math.floor` beats | You violated invariant #15 — read the per-beat ownership section of **ballroom-flow-crdt-reference**; the pin is fork.test.ts "the Passing Tumble Turn: base additions reach untouched beats only (§5.2)" |
| A beat's content "visually disappears" on first edit of an unowned beat | Copy-down (#16) skipped — the edit landed without materializing the base's current beat | Route the edit through `variantAttributesForEdit` with the full resolved timeline |
| Editing a variant changed the global doc (or vice versa) | A store write targeted the wrong `figureConn`, or the DO admin gate is missing | Invariant #17 violated — check which docRef the change frame went to; verify the DO refuses non-admin global writes |
| A v4 routine renders differently after your change | Back-compat broken — a full-timeline copy must resolve to exactly itself | Add/restore the v4-shape pin test before anything else (PLAN §9 back-compat note) |
| Automerge throws `Cannot set property ... undefined` | Wrote `undefined` into a doc | Use `stripUndefined` (`packages/domain/src/doc-internal.ts`); `null` is fine, `undefined` never |
| Worker test flakes across runs | Reused DO id under `isolatedStorage: false` | Unique id per test via `apps/worker/src/test-support/do-id.ts`; see **ballroom-flow-validation-and-qa** |
| Two-client E2E sees stale content after your catch-up change | "open" ≠ "hydrated" — client edits before `SYNC_CAUGHT_UP` applied | Re-read the hydration saga (97e7fea/4ef16ac) in **ballroom-flow-failure-archaeology** before patching |
| A peer/RPC change is silently ignored — `applyRawChange`/`ingestChange` returns false, heads unchanged | Live-doc vs persisted-lineage divergence — a regression of the FIXED migrateOnLoad incident (§2, #139), or a new path that persists without advancing `this.doc` | Diff the persisted change log against `A.getAllChanges(this.doc)`; see the §2 incident box + **ballroom-flow-debugging-playbook** row 12 |

## 8. Validation & promotion protocol

Success is **measured, never judged by eye** — route every phase exit through **ballroom-flow-change-control**. The concrete gates:

- **Named journeys:** `fork-and-figures.spec.ts` (variant + fork semantics), `library.spec.ts` (bookmark), `undo.spec.ts` (routine + figure-editor undo), `convergence.spec.ts` (catch-up/resend). @smoke runs on every PR (`ci.yml`); full 3-project matrix nightly.
- **Invariant tests:** PLAN §2.5.1 #14–18 stay pinned in `packages/domain/src/fork.test.ts` + `convergence.test.ts`; any new store/worker resolution path gets its own back-compat pin (v4-shape figure resolves to itself).
- **EXPLAIN gates:** any new/changed D1 query proves no-table-SCAN via `apps/worker/src/test-support/explain.ts`.
- **Coverage ratchet:** thresholds are armed (domain lines 90, worker 88 as of 2026-07-02) — new code arrives tested or CI fails.
- **PR hygiene:** branch off `development`; PLAN §9 checkbox + TEST-MAP row flipped in the same PR; feature is "done" only when its journey is green on PR.

## Provenance and maintenance

Authored 2026-07-02 against repo HEAD `70eed7e`; refreshed at `3693ff6`; **refreshed again
2026-07-02 (afternoon) — verified at HEAD `759b3a8` (PR #141 figure-editor undo included)** (after PR #139 migrateOnLoad-fix
903d109/8ddd147, PR #136 library-bookmarks b910dc0, PR #137 global-figure-docs + admin seams
c9622c9) on `development`. All file:line claims, route paths, suite counts (domain 245/3
skipped, contract 14, web 343, worker 180/7 skipped — all green, re-run directly), and the
DONE/OPEN audit were verified directly against that tree; PR/commit hashes come from git
history. PR #140 (601032a) was closed as superseded by #139. Issue numbers like #161/#168
are an internal ledger, not GitHub issues. Line numbers drift — re-anchor by symbol, not line.

Re-verify before relying on the audit:
```bash
grep -n '☐' docs/PLAN.md                                           # zero open boxes since PR #141?
grep -n "this.doc = fresh" apps/worker/src/doc-do.ts               # the #139 adopt still in place
grep -n "resolveVariantOverlay" apps/web/src/store/routine.ts      # store overlay resolution live
grep -rn "isAdmin\|routineCapOverride\|libraryFigureRefs" apps packages --include='*.ts' -l | head
grep -n "SYNC_FRAME_SNAPSHOT" apps/worker/src/doc-do.ts            # snapshot catch-up in place
grep -n "CURRENT_SCHEMA_VERSION" packages/domain/src/migrations.ts
pnpm --filter @ballroom/domain test && pnpm --filter worker test   # current counts, both green
```
