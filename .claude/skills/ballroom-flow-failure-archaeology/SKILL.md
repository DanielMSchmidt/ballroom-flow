---
name: ballroom-flow-failure-archaeology
description: Load BEFORE re-designing, re-litigating, or re-investigating anything in weave-steps — the chronicle of every settled battle (2026-06-24 → 2026-07-02): investigations, root causes, dead ends, rejected fixes, reverts, and the live-vs-frozen figure model reversals. Use when a bug looks familiar, when tempted to revisit an architecture decision (Yjs, polling reads, frozen copies), when a PR/commit reference needs context, or when deciding whether something is a new problem or an old one.
---

# Weave Steps — Failure Archaeology

The complete record of what already went wrong, why, and how it was settled. **Check here before investigating a symptom or proposing a design** — most battles in this repo have been fought once already, and several were fought twice.

**When NOT to use this:** for *how to fix a live bug now*, use **ballroom-flow-debugging-playbook** (symptom→action runbooks). For the current binding rules and locked decisions, use **ballroom-flow-architecture-contract** and docs/PLAN.md §8 — this skill explains *why* they're locked. For executing the active migration, use **ballroom-flow-v5-migration-campaign**. For process rules (TDD, branching, PLAN sync), use **ballroom-flow-change-control**.

## 60-second triage checklist

Before investigating anything:

1. **Grep this file for the symptom** (e.g. "Unknown figure", "flicker", "Untitled routine", "flake", "reload"). If it's here and FIXED, look for a regression of the recorded fix, not a new cause.
2. **Scan the 11 recurring patterns** (bottom of this file) — new bugs almost always land in an existing pattern; the pattern's rule tells you where to look.
3. **Check Still-OPEN items** — if the "bug" is an unchecked PLAN §9 box, it's known work, not a regression.
4. **If it's a design debate**, read the oscillation timeline and PLAN §8 D10/D12 first — the alternative you're about to propose may already be recorded as rejected, with the scenario that killed it.
5. **Check the base branch** (`git branch --show-current`; work starts from `development`) — the single most expensive mistake in this repo's history was building on `main`.

## How to read this chronicle

- All hashes are on `origin/development` unless marked **(main-only)**. Verify any hash with `git show -s <hash>`.
- **Status legend:** FIXED (shipped, on development) · REVERSED (decision later overturned — read the reversal before relying on it) · REJECTED (tried and rejected, rationale recorded) · OPEN (known, not yet done).
- **Internal ledger numbers are NOT GitHub issues.** References like `#63, #109, #161, #168, #173, #187, #201–#205` in commit messages come from a **gitignored scratch task ledger** (`.superpowers/`, line 16 of `.gitignore`) — they do **not** resolve on github.com. GitHub has exactly one real issue (#5, Renovate dashboard). PR numbers (`PR #NN`) *are* real GitHub PRs.
- Timeline density: 131 PRs in 8 days (2026-06-24 → 2026-07-02), mostly AI-agent-authored under owner review. Expect squash merges; early PRs (< #60) appear only in commit subjects like `(#57)`, not as merge commits.

---

## The model-oscillation timeline (read this before touching the figure model)

The figure-sharing model reversed **twice**. Each position is recorded with its rationale; do not re-open it without a new concrete scenario that beats the recorded one.

| # | Decision | When / evidence | Why |
|---|---|---|---|
| 1 | **Yjs recommended** for CRDT layer | v3 plan + CRDT research, `de89e00`, `12dd3db` (2026-06-25) | Library-merit comparison favored Yjs + y-partyserver. |
| 2 | **Reversed to Automerge** | v4 plan, `370de7c` (2026-06-25) | The owner chose full-power cross-routine **forking** as the v1 centerpiece; Automerge's history/clone model serves it. A library recommendation was overturned by a *product* requirement, not tech merit. |
| 3 | **Live overlay variants** (`resolve(base, overlay)`, flow-up) | v4/v4.3 plan, `8f49169` | Original inheritance design. |
| 4 | **Reversed to frozen choreo-owned copies** | 2026-06-29, `9f0357d` + `7f6d811` (PRs #97/#99/#100/#104); overlay leftovers scrubbed `64e6441`, vestigial `Overlay` type removed with v2→v3 strip migration `edc4c82`; TEST-MAP reconciled `322f42c`/`33aff06` (PLAN v4.4) | Copy-on-write triggered by *location*: editing a figure that lives outside this choreo makes a frozen snapshot; `baseFigureRef` demoted to provenance-only. "An edit in one choreo never changes another." |
| 5 | **Reversed back to live figures with per-beat-ownership overlay variants** | **PLAN v5.0**, 2026-07-02, `e27bca6` (PR #132) — current model | Settled by working the model against a named concrete scenario: the ***Passing Tumble Turn*** (catalog Tumble Turn placed twice in a Slowfox; one placement re-choreographed for its last ~3 beats; a new catalog attribute must flow into *untouched* beats only). Frozen copies can't do that. **Per-beat ownership** (`resolveFigure(base, variant)` — variant owns exactly the beats it carries content on) is the precision the v4 overlay lacked. PLAN §5.2, D12. |

**The lesson (applies to every future architecture debate):** oscillation stops when someone names a **concrete end-to-end scenario** — Passing Tumble Turn (frozen vs live), the US-015 convergence journeys (read/edit split), the forking requirement (Yjs vs Automerge). PLAN.md records rejected alternatives **inline** in the locked decisions (see D10 and D12 in docs/PLAN.md §8) precisely so they don't get re-proposed. If you want to reverse a decision, bring a scenario that beats the recorded one, and update PLAN.md in the same change.

---

## Chronicle of settled battles (dated)

### 2026-06-24/25 — Plan evolution v1→v4.3 (PR #9, the "owner review" PR)
Initial design had couple+coach roles, typed step-slot columns, "Sides", separate Thread/Journal models, a bespoke op-log. **v2** (`94187e4`): flat roles (viewer/commenter/editor + owner; leader/follower became a per-device view preference), float-count attribute timeline, Sections replaced Sides, unified Annotation, dropped the op-log. **v3** (`de89e00`): CRDT-in-Durable-Object foundation. **v4** (`370de7c`): Automerge (see oscillation table). **v4.3** (`8f49169`): count fractions had been **swapped** and were corrected (e=.25, &=.5, a=.75); the M0.5 spike gate was added. **Status: FIXED/superseded by v5.**

### 2026-06-25 — M0.5 spike: Automerge-on-Cloudflare GO, with 4 sharp edges
`0f2059b`; findings live in `docs/spike/SPIKE-FINDINGS.md`; spike code deliberately deleted (`b09d5e5`). Edges: (1) vitest-pool-workers `isolatedStorage` is incompatible with SQLite-backed DOs (-shm/-wal sidecars) → **`isolatedStorage: false` + unique DO id per test**, still binding; (2) full save/load per op too costly → incremental changes + alarm compaction; (3) **WS/hibernation was NOT exercised** in the spike (DO RPC stand-in) — deferred to M2; (4) skip automerge-repo, use core Automerge + hand-rolled sync (D6). Also `b553918` (PR #20): Automerge-3.x gotchas (clone-before-reuse, heads-not-bytes). **Status: FIXED — these are the constraints the whole worker test harness is built on.**

### 2026-06-26 — a fix silently dropped in a squash race (PR #51)
The internal-#187 squash (PR #50) carried half of the internal-#173 shared-D1 fix but **dropped the seed try/catch** for the `d1_migrations` UNIQUE collision — a concurrent direct-push race clobbered it; ~4 tests failed on re-runs until `79b927d` restored it. **Status: FIXED.** Pattern 9: fixes get lost in squash/merge races — re-verify after merging.

### 2026-06-26 — the hydration & durability saga (PRs #56/#57/#58)
Two *distinct* flake classes that looked identical ("edit lost after reload"):
- **Hydration** (`97e7fea`, internal #202, PR #57): the store flipped "live" when the socket reached **OPEN**, before connect catch-up had been applied — edits went into a not-yet-replayed doc. Passed only on localhost timing. Fix: the DO sends an explicit `SYNC_CAUGHT_UP` marker; "live" = catch-up-applied.
- **Durability** (`4ef16ac`, internal #205, PR #58): initial CRDT content was written by the **client** after create — an immediate reload lost it ("Untitled routine"). Fix: server-side `seedDoc(content)` DO RPC, **no-clobber**, seeded before any client connects. Caught by E2E `--repeat-each`.
**Status: FIXED.** Distinguishing the two classes was the breakthrough — don't lump reload flakes together.

### 2026-06-26 — E2E journeys skipped with a stale reason (PR #61)
Convergence journeys had been skipped as "not built yet" long after the machinery existed; `d49fb52` unskipped and proved live two-client convergence (US-015). **Status: FIXED.** Audit skip reasons — they rot.

### 2026-06-26 — commenter gate is effect-based (`eb04a33`)
A commenter's sync frame is classified by **apply-and-diff effect**, never by a client-declared label (a mislabelled frame could smuggle structural edits). Foundation for the later `99fa1b9` authorship gate. **Status: FIXED — a binding principle (pattern 4).**

### 2026-06-27 — alarm step isolation (`6c3b8ab`, PR #75)
`alarm()` ran compact → projectToD1 → expireInvites unguarded; one transient D1 error silently skipped invite expiry. Each step is now an independent try/catch. **Status: FIXED.**

### 2026-06-28 — the "Unknown figure" / figure-seed-race cluster (PR #81 combining closed #78/#79/#80; PR #94)
Four intertwined causes behind one symptom:
1. UI collapsed *loading* into *missing* — `621721e`: null figure = loading, render a skeleton, never "Unknown figure".
2. Server: connect catch-up used `getDoc()`, which **auto-materialized and PERSISTED an empty placeholder** into an unseeded DO, tripping `seedDoc`'s no-clobber guard; and `seedDoc` **persisted but never broadcast** to already-connected sockets (`c43ebed`).
3. Client: `addPlacement` opened the figure DO connection **eagerly, before** `POST /api/figures` had seeded it → empty catch-up. Fix: `pendingFigures` gate — connect only after create resolves (`9509d30`).
4. Resilience: `2cdeee8` (PR #94) added DocConnection auto-reconnect with capped backoff, a per-figure `FigureLoadStatus` (pending|loading|live|missing|error), and a registry preflight to distinguish *missing* from *failed*.
**Status: FIXED.** (PR #90, closed unmerged, attacked the same symptom on the wrong architecture — see Dead ends.)

### 2026-06-28 — THE #83/#85 revert: the wrong-branch incident (main-only)
PR #83 (merged to `main` as `9106f63`): a whole skeleton-based `packages/domain` figure library, built by branching from **`main` (a stale skeleton) instead of `development` (the live app)** — it duplicated overlay.ts/fork.ts/library-data.ts/FigureTimeline that already existed on development. PR #85 (`720103d`) reverted it entirely; PR #84 was closed unmerged for the same reason. ~**1269 lines thrown away**; the work was redone from development as PR #86 (`3ff2d8c`) + #87. Institutional fix: the CLAUDE.md git-flow warning (PR #88/#89 on both branches). `main` still permanently diverges from development by exactly these commits: `10fc692 015c984 f3f5e46 720103d 9106f63 c0dd903 a9f115a f6e3ff0 b4880de`. **Status: FIXED (process). Always branch from `development`.**

### 2026-06-28 — read/edit split: rejected *within its own PR* (PR #95 → PLAN D10)
First cut (`9416875`): read via REST snapshot + polling for EVERYONE, upgrade to a WS only on first edit. **Rejected before merge**: a passive co-editor on a polled snapshot only saw a collaborator's edits on the ~20s poll — it broke 5 @smoke US-015 convergence journeys. *"Polling can't deliver live convergence."* Final (`01365dc`): **role-aware hybrid** — viewers get snapshot-only, zero sockets; editors/commenters open ONE eager routine WS; a figure's own WS opens only when its step editor opens. The rejected alternative is recorded inline in PLAN.md §8 D10. **Status: FIXED / alternative REJECTED — do not re-propose read-by-default.**

### 2026-06-29 → 07-01 — frozen-copy interlude (PRs #97/#99/#100/#104)
See oscillation table row 4. `resolve(base, overlay)`/"flow-up" retired; copy-on-write on *location*; `Overlay` type removed with a v2→v3 strip migration. **Status: REVERSED by PLAN v5.0** — but the hardening/cleanup work done during it (migrations, TEST-MAP reconciliation) stands.

### 2026-06-30 — reorder convergence, internal #63 (`38dfba7`, PR #107)
Reorder was a JSON-copy **splice** (delete + reinsert a plain copy): correct single-client, but it lost concurrent edits to the moved item, and two concurrent splices clobbered order. Fix: `sortKey` **fractional index** (base-62 midpoint, `packages/domain/src/order.ts`) — reorder is a per-field update; moved objects are never deleted; v3→v4 backfill migration. **Status: FIXED.** The canonical positional-vs-identity CRDT lesson (pattern 1).

### 2026-06-30 — every "successful" deploy shipped the E2E auth-bypass bundle (`e71d06d`, PR #106)
Staging served the `VITE_E2E=1` build: `e2e/serve.sh` built into the **same `apps/web/dist`** the deploy ships, and the deploy job's E2E-smoke step rebuilt dist in E2E mode *after* the real Clerk build. Fix: E2E builds go to a separate `dist-e2e` + a separate wrangler env, gitignored — **output isolation, not step reordering** (reordering would have been one refactor away from regressing). **Status: FIXED.**

### 2026-06-30 — the a11y axe flake, root-caused (`ad22e16`, `b419e0a`)
"Dominant CI flake for a day": a prop-less `<FigureLibrary/>` rendered the whole catalog (~240 figures, ~2975 DOM nodes); axe is O(nodes) → 13–17s under parallel CI load vs a 5s timeout. A **deterministic timeout-edge**, not randomness. Fix: render one dance (markup-identical coverage) + timeout headroom; Playwright assertion timeout also raised for wrangler-dev "Connection reset by peer" cold-start stalls. **Status: FIXED.** Pattern 11: flakes get root-caused, never retried away.

### 2026-06-30/07-01 — the figure-data quality war (PRs #117/#118)
- `1f67e38`: the entire figure library re-charted from real WDSF technique after prose scaffolding leaked "LF/RF" foot text into the UI ("feet are never shown anywhere"); **37 unverifiable figures were removed rather than guessed** (241→204).
- `58a11f6`: **adversarial verification** — an independent verifier re-fetched every source and judged all 203 proposed cell changes: 160 CONFIRM / 18 REJECT / 23 UNCLEAR-left-as-is. Caught CBMP-vs-CBM confusions and pivot footwork on entry walks.
- `01284a9`: second-source hunt for Tango Fallaway Reverse & Slip Pivot footwork; provenance recorded instead of fabricating. `d2d4b75`: turn enum extended past a half turn (real 3/4 turns had been silently capped).
- `4b9cf8a`: reconciled vocabulary to the design bundle but **pushed back on two designer errors** (Turn "Continue" is not a per-step amount; "CBP" is a slip for CBMP) — the design was fixed, not adopted.
**Status: FIXED — and the standard.** Never invent domain data; verify or delete. (See ballroom-flow-figure-data-pipeline.)

### 2026-07-01 — the two flicker fixes
- `42f7d39` (PR #121): figure-editor flicker/reset from live sync. Root cause: the store re-materialized docs (`A.toJS`) **every sync frame** → fresh object identity per render; plus the hybrid could swap a stale REST snapshot under an open editor. Fix: heads-keyed `DocConnection.materialized()`, `readPlacements` array reuse, latch-to-live-once-hydrated, step editor waits for the figure's own live doc.
- `90bed2d` (PR #130): add-figure overlay flicker — `useOverlay` keyed its effect on an inline `onClose` closure (fresh identity every render) → every sync frame tore down and re-ran the focus-grab + scroll-lock. Fix: read `onClose` through a ref; key the effect on `open` alone.
**Status: FIXED** (pattern 5). Both hardenings are now recorded in PLAN D10.

### 2026-06-29 → 07-01 — auth-flow dead ends (three distinct holes)
- `f2a6180` (PR #96): signed-in users flashed the marketing Landing page (Clerk reports `isSignedIn: false` until loaded) → thread `isLoaded` through a pure `appGate` + neutral loading state.
- `619c16e` (PR #127): signed-out share-link visitors hit a dead-end card with no sign-in control (`!isSignedIn` was checked *before* the invite branch).
- `92ace53` (PR #128): a routine **owner's own figureType notes never surfaced on their own routine** — the owner is elevated by `resolveEffectiveRole` **without a membership row** (internal #168), so an author set built from `listMembers` excluded them.
**Status: FIXED.** The owner-has-no-membership-row asymmetry (pattern 4) will bite again anywhere that enumerates members.

### 2026-07-02 — the architecture review + v5 reversal (PR #132, merge `70eed7e` — the biggest single event)
Docs: `e27bca6` (PLAN v5.0, see oscillation table) + `17eee40` (USER-STORIES.md deleted; PLAN §9 + TEST-MAP are the roadmap/test index). Four review-verified criticals fixed in the same PR:
1. **Undo soundness** (`3725ec9`): (a) inverse patches carried **historical list indices**; positional replay against the current doc deleted a concurrent peer's element — fix: simulate the inverse against the historical state at the target's heads and record identity-anchored ops (element ids); (b) a second undo press re-selected and re-inverted the **same** change destructively — fix: undo/redo messages carry the reverted change hash (`ballroom:undo:<hash>`); a change is reverted at most once; (c) text-deletion inverse silently no-opped.
2. **`POST /api/figures` authorization hole** (`089dbc0`): any authenticated caller + upsert semantics meant posting an *existing* figureRef rewrote the victim's registry title AND inserted the caller as editor; an unchecked `routineId` allowed self-escalation via the membership cascade. Fix: caller must resolve editor/owner on the routineId; guarded insert (`onConflictDoNothing` + owner re-read); cross-owner → 409 with zero writes.
3. **Alarm D1-projection clobber** (`9edab0a`): production never called `setMetadata`, so once a doc hit the compaction threshold (or gained one annotation) the alarm upserted `ownerId=''` / `title=NULL` / `type='routine'` over the eagerly-created registry row — the owner lost DELETE rights and routines vanished from quota/owned lists. Fix: project identity **from the loaded doc**; non-destructive upsert (CASE/COALESCE).
4. **Boundary enforcement past the handshake** (`99fa1b9`): the role was resolved once at connect and frozen in the hibernation attachment — a **removed editor kept live write access** until reconnect. Fix: `refreshConnectedRoles()` (re-resolve from D1; close revoked sockets with 1008), invoked by member-removal/invite-redeem. Plus: commenters could edit/tombstone ANY author's annotation (client-controlled `authorId`) — authorship is now checked against the socket-verified `sub`.
**Status: all four FIXED (✅ items in PLAN §9 v5 step 1). The rest of the milestone landed the same day (entries below); only figure-editor undo remains.**

### 2026-07-02 — three v5 boxes shipped in one afternoon (PRs #134/#135/#133)
Landed after the #132 review, in merge order:
- **PR #134 sync-hardening** (`84c3eea`, `cd06daa`, `df24778`, `054d91e`): the three D10 leftovers. Connect catch-up became **ONE `SYNC_FRAME_SNAPSHOT`** (`A.save` blob; client `A.load`s + **merges**, so unacked edits survive) instead of the unbounded per-change replay; the client **re-sends unacknowledged local changes on reconnect** (diffs `getChanges(serverDoc, merged)` after the snapshot merge; idempotent server-side); a **broadcast send failure closes the socket** with `SYNC_RESYNC_CLOSE_CODE` (4001) so the client warm-reconnects to a fresh snapshot instead of silently diverging. New wire envelope in `@weavesteps/contract`: server→client binary frames carry a 1-byte type tag (`SYNC_FRAME_SNAPSHOT`/`SYNC_FRAME_CHANGE`); client→server frames stay raw (asymmetric). **Deliberate hard protocol cutover** — old client ⇄ new server drops frames until reload; a WS-subprotocol version is the recorded escape hatch.
- **PR #135 migration-ladder-wiring** (`eee3f5b`, `8146621`, `2fc7371`, `b2e494f`): the ladder finally **runs on the DO load path** — `loadPersisted` → `migrateOnLoad` runs `migrateDraft` inside an `A.change` attributed to a fixed `MIGRATION_ACTOR` (per-user undo can never select it) and persists the upgrade; every seed site (`starter-routine.ts`, `doc-do.ts` `emptyRoutine`, worker `index.ts`, `sample.ts`, `test-seed.ts`, the web store placeholders) stamps `CURRENT_SCHEMA_VERSION`. The old "ladder defined but not wired into any runtime path" state is history.
- **PR #133 v5-fork-copy** (`8cb646c`, `0e65912`, `0a3f841`): PLAN §9 v5 **step 5 ✅** — fork re-points every placement whose ref resolves to a registry `type='account-figure'` at a fresh forker-owned `copyFigureForFork` copy (D1-projected + DO-seeded **before** the fork's routine doc is seeded), `placement_edge` per copy; global/dangling/app-template refs stay live; an `account_figure_base_idx` collision reuses the forker's existing derivative.
**Status: all three FIXED/shipped — but the #133/#135 interaction caused the lineage incident below (itself now fixed).**

### 2026-07-02 — the migrateOnLoad lineage divergence (found post-merge; FIXED by PR #139)
**Symptom:** `development`'s tip (`3693ff6`) was **red** — `routes/fork.test.ts` "is independent of the origin" failed **deterministically** (an edit to the origin figure never lands: `applyRawChange` returns false, heads unchanged, change silently swallowed as a "duplicate"). Each of #133/#135 was green on its own merge ref; only their combination failed.
**Root cause:** `migrateOnLoad` (#135) persists the migration change even when it runs inside a **transient read** — `getFigureSnapshot` and the connect catch-up call `loadPersisted` **directly**, not `getDoc` — so the persisted change log gains `ballroom:migrate` while the instance's already-materialized `this.doc` never applies it. The two diverge into different lineages; a peer change built on the persisted heads (#133's fork flow replays the change log — the same lineage a freshly caught-up client holds) arrives at `ingestChange` with a **missing dep**, Automerge defers it, heads stay unchanged → the "heads unchanged = duplicate" dedupe silently drops it.
**Evidence:** instrumentation showed persisted log = `[seed d073b9ac, ballroom:migrate(deps d073b9ac)]` vs `this.doc` = `[seed d073b9ac]` only.
**Fix (PR #139, `903d109`, merged as `8ddd147`):** `migrateOnLoad` now **adopts the migrated clone wholesale** (`this.doc = fresh`, `doc-do.ts` :265) — monotonically safe because every ingested change is persisted immediately, so `this.doc` is always a prefix of what SQLite replays. This restores the invariant that the change log never contains a change the live doc hasn't applied (the invariant `ingestChange` maintains by persisting only after a successful apply). Notably, **two sessions root-caused this independently and converged on the identical fix** — PR #140 (`601032a`, branch `fix/migrate-on-load-live-doc`) was closed as superseded by #139.
**Status: FIXED** — the worker suite is green at `c9622c9` (180 passed / 7 skipped). Same failure family as pattern 2: state written on one path (persisted log) that another path (the live doc) never observes.

### 2026-07-02 (afternoon) — the v5 milestone lands: steps 3, 4, 6 in two PRs
With the lineage fix in, the remaining v5 model work merged the same afternoon:
- **PR #136 library-as-bookmark** (merge `b910dc0`; `ed59aa9`, `315c819`, `f83883f`, `7962b93`, `f4aef0e`): PLAN §9 **step 4 ✅**. Account-doc `libraryFigureRefs` (domain `addLibraryRef`/`removeLibraryRef`) + the `library_entry` D1 projection (migration 0015, `apps/worker/src/db/library.ts`); `POST /api/figures/save-to-library` became a **bookmark** (accepts `{ figureRef }` or the legacy triple resolved to `globalFigureRef` — no copy), DELETE un-bookmarks (tombstone), `GET /api/figures/mine` is bookmark-driven; "add to my library" affordance in Assemble + FigureTimeline. The account doc is still not DO-wired — `library_entry` is the persisted state today (recorded in PLAN §9 step 4).
- **PR #137 global figure docs + admin seams** (merge `c9622c9`; `71b7aa2`, `1e71cec`, `6c371b8`, `26e8e8b`, `3b50802`, `60bfb70`): PLAN §9 **steps 3 + 6 ✅**. Additive idempotent `seedGlobalFigures` into real admin-owned docs + admin-only `POST /api/admin/seed-global-figures`; the `resolveEffectiveRole` global-figure boundary (any user → viewer, admin → editor); catalog placements became **live references**; the snapshot fans out variant **bases**; the store's edit-global path became `spawnVariant` + per-beat overlay resolution on read (the frozen-style store read is gone); `isAdmin` + `routineCapOverride` (migration 0014) with the `routineCapFor` quota seam on create AND fork, surfaced via `/api/me`.
- **PR #141 figure-editor undo** (merge `759b3a8`; `e14c5cb`, `d9072a8`): the FINAL PLAN §9 box ✅ — `undoFigure`/`redoFigure` on the store seam invert this tab's actor's last change on the figure's own `DocConnection` (per-tab actor seeding makes figure edits attributable); the full-screen editor header carries the affordance (undo follows the surface being edited, §5.4).
**Result:** the v5 milestone is COMPLETE — zero `☐` boxes in PLAN §9. Audit: **ballroom-flow-v5-migration-campaign** §2. **Status: shipped.**

### Smaller settled battles
| What | Evidence | Resolution |
|---|---|---|
| Tango-omits-Rise enforced on the **write** path, not just UI | `5657c62` | `dance_not_applicable` rejection. FIXED |
| Undo "superseded by others" | `8bea829`, `d50690f`, `713f71b` | **Soft hint, never a refusal** (US-038 AC-3, PLAN §5.4). FIXED |
| T6 journal privacy | `17ed37e` | Viewer phantom-success closed; account arm tightened to co-member symmetry; hot-path per-change JSON double-serialization replaced by an Automerge patchCallback touch-signal. FIXED |

---

## Dead ends & closed-unmerged PRs (do not resurrect)

| PR(s) | What it was | Why it died |
|---|---|---|
| **#83 / #84** | Skeleton-based `packages/domain` figure library | Built from **`main`** (stale) instead of `development`; #83 merged to main then fully reverted by **#85**; #84 closed unmerged. Redone correctly as #86/#87. |
| **#78 / #79 / #80** | Three partial attacks on the "Unknown figure" seed race | Closed unmerged, superseded by the combined **#81**. |
| **#90** | Three-state RemoteData/TanStack loading fix | Right idea, **wrong architecture** — built against the retired online-only RPC design after development had moved to Automerge sync. The idea shipped correctly at the store seam as `FigureLoadStatus` in PR #94. |
| **#26** | (early) | Redone as #27. |
| **#64** | (early) | Duplicate. |
| Renovate #1/#3/#4 | Dependency PRs | Closed; the allowlist migration merged separately via #8. **#113** (Renovate pnpm 11) was still open at the 3693ff6 refresh. |
| **#140** | The migrateOnLoad lineage fix (`601032a`) | Closed as **superseded** — an independent session root-caused the same incident and PR #139 (`903d109`) merged the identical fix first (see chronicle). Not a rejected idea; a duplicate. |

Also REJECTED (never a PR of its own): the read-by-default polling split inside PR #95 — see D10 above.

---

## The 11 recurring failure patterns

Each pattern is a rule earned by ≥1 incident above. When triaging a new bug, scan this list first — new incidents almost always land in an existing pattern.

1. **Positional vs identity addressing in CRDTs.** Never address Automerge list elements by index across time; never delete-and-reinsert to move. Bit twice: splice-reorder (internal #63, `38dfba7`) and undo inverse (`3725ec9`).
2. **"Open" ≠ "hydrated" ≠ "durable" ≠ "broadcast".** Every state transition needs an explicit acknowledged signal; state written on one path must be observed by every other path. Incidents: `97e7fea` (live-on-OPEN), `4ef16ac` (client-side seed), `c43ebed`/`9509d30` (seed persisted-not-broadcast; eager connect), reconnect resend (internal #161, shipped PR #134), and the **migrateOnLoad lineage divergence** (persisted change log ≠ live doc; fixed by PR #139/`903d109`, above).
3. **D1 projections racing/clobbering doc state.** The Automerge doc is the source of truth; projections must be non-destructive and derive identity from the doc. Incidents: `9edab0a`, `6c3b8ab`.
4. **Authorization checked once / by label / asymmetrically.** Gate by verified identity + observed effect; re-check on membership change; remember **owners are not in the members table**. Incidents: `99fa1b9` (frozen role + client authorId), `eb04a33` (effect-based gate), `089dbc0` (upsert-as-escalation), `92ace53` (owner asymmetry).
5. **React re-render churn from unstable identities on sync frames.** Heads-keyed memoization at the store seam; never key effects on caller-supplied closures. Incidents: `42f7d39`, `90bed2d`.
6. **Two-state models collapsing "loading" into "missing".** Loading / resolved / missing / error must be distinct states. Incident: the whole "Unknown figure" saga (`621721e`, `2cdeee8`).
7. **Model oscillation is resolved by concrete scenarios.** Named end-to-end scenarios or failing journeys settle architecture debates; PLAN.md records the rejected alternative inline (D10, D12). Incidents: the whole oscillation table.
8. **Branch-discipline failures are expensive.** ~1269 lines thrown away in #83/#85; #90 built on a retired architecture. Check the base branch (`development`, never `main`) before building.
9. **Build/test artifacts leaking into production paths — and fixes lost in squashes.** Fix by output isolation, not step ordering (`e71d06d`); re-verify fixes after merge races (`79b927d`).
10. **Data integrity by verification, not generation.** Catalog re-charted from sources, adversarially re-verified (160/18/23), unverifiable entries deleted, designer errors pushed back (PRs #117/#118).
11. **Flakes get root-caused, not retried.** axe O(nodes), shared-D1 collisions, wrangler cold-start, hydration-vs-durability flake classes distinguished. Never weaken a test to pass; audit stale skip reasons (`d49fb52`).

---

## Still-OPEN items (as of 2026-07-02, HEAD `759b3a8`)

**The v5 milestone is COMPLETE — zero ☐ boxes in docs/PLAN.md §9** (the last one,
figure-editor undo, shipped in PR #141). Remaining work is the tracked follow-up tail and
the watch-items below — known, tracked work, not regressions. Consult
**ballroom-flow-v5-migration-campaign** §2/§4 before building on any shipped step. The
suite is fully green at this HEAD
(domain 245/3 skipped, contract 14, web 343, worker 180/7 skipped) — a red test is YOUR
change or a genuine regression, not a known incident.

Beyond that box: the tracked **follow-up tail** (security comments, perf, a11y, sortKey
convergence, reconnect — CLAUDE.md §6) lives in the task board, and three standing
**watch-items** (PLAN §12): per-document DO fan-out at scale; full-syllabus content effort;
notation-loop validation with the primary persona. All OPEN (watch), none started.

Source-code TODO/FIXME count is effectively zero — debt lives in the PLAN boxes, not in comments.

---

## Provenance and maintenance

Compiled 2026-07-02 against repo HEAD `70eed7e`; refreshed at `3693ff6`; **refreshed again
2026-07-02 (afternoon) — verified at HEAD `759b3a8` (PR #141 figure-editor undo included)** (adds the #139 lineage fix — closing the
migrateOnLoad incident — and the #136/#137 v5-completion landings; PR #140 closed as
superseded by #139) on `development`, from git history (`git log origin/development`), the divergent `main` history, PR merge commits, docs/PLAN.md v5.0, and docs/spike/SPIKE-FINDINGS.md. Every commit hash above was verified to exist via `git show -s <hash>`; every merged PR number was verified against the merge-commit log; #83/#85/#89 verified on `origin/main`. Closed-unmerged PR dispositions (#78–#80, #84, #90) and the "GitHub has one real issue" claim come from the handoff investigation and match the absence of those PRs in local merge history, but were not re-checked against the GitHub API here — treat as **verified-by-absence**.

Re-verification commands for anything that may drift:

```bash
git show -s <hash>                                   # any hash cited above
git log origin/development --merges --format='%s' | grep -oE '#[0-9]+' | sort -u   # merged PR set
grep -n '☐' docs/PLAN.md                             # the still-OPEN v5 boxes (§9)
git log origin/main --not origin/development --oneline   # the permanent main-only divergence
grep -n 'superpowers' .gitignore                     # the internal ledger is still gitignored
grep -n 'v5.0' docs/PLAN.md | head -2                # PLAN version — if >v5.0, this chronicle needs a new entry
```

If PLAN.md's version advances past v5.0 or the §9 boxes change, append a dated chronicle entry here **in the same change** — this skill rots exactly as fast as the plan does.
