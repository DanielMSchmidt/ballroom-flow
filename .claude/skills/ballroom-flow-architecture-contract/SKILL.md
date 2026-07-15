---
name: ballroom-flow-architecture-contract
description: Load when designing any change to Weave Steps that touches data shape, document boundaries, sync, permissions, or module structure — before writing a spec, adding a table/column, moving code between packages, or questioning a design decision. Digests the locked decisions (docs/system/architecture.md § Global constraints), the invariants that must hold (with where each is enforced), and the known weak points as of 2026-07-02.
---

# Weave Steps — the architecture contract

This skill is the load-bearing map: what the system IS, which decisions are locked and why,
which invariants your change must not break, and where the known cracks are.
**`docs/README.md` (the index) is the mandatory first read; `docs/concepts/` + `docs/system/`
are the single source of truth for current state — this is a digest.** If this skill and
those docs ever disagree, the docs win and this skill has a bug.

**When NOT to use this:**
- Automerge/CRDT mechanics (why `undefined` throws, convergence assertions, undo internals) → **ballroom-flow-crdt-reference**.
- Executing the active v5 figure-model migration (steps, sequencing, back-compat) → **ballroom-flow-v5-migration-campaign**.
- Process rules (TDD, branch flow, docs/concepts+docs/system-updated-in-same-change) → **ballroom-flow-change-control**.
- Ballroom domain concepts (figures, counts, footwork, alignments) → **ballroom-dance-reference**.
- Setting up / running / deploying → **ballroom-flow-build-and-env**, **ballroom-flow-run-and-operate**.
- Debugging a live symptom → **ballroom-flow-debugging-playbook**.

## 1. The system in one screen

Weave Steps is a collaborative, mobile-first PWA for building ballroom choreography.
Canonical state is a **graph of Automerge documents** (Automerge = a CRDT library:
every replica can edit independently and all replicas deterministically converge).

```
apps/web (React PWA)
  components/  — render only; NEVER import Automerge or lib/rpc
  store/       — THE seam: owns Automerge docs, WebSockets, REST calls
  ui/          — design-system primitives (token-driven)
        │ REST (Hono RPC, Zod-typed)          │ WebSocket sync (one per open doc)
        ▼                                      ▼
apps/worker (Cloudflare Worker, Hono)   DocDO (Durable Object)
  routes: list/search/invite/quota/…      ONE DO instance PER DOCUMENT
  Clerk auth middleware                    hosts the Automerge doc in DO SQLite
        │                                  = the sync + PERMISSION boundary
        ▼                                  alarm: compaction + D1 projection
  D1 (SQLite at the edge)  ◄───────────────┘ (projection is one-way, doc → D1)
  PURE INDEX/REGISTRY — no CRDT content, no op-log, ever
```

- **Document types:** routine docs (sections, placements, annotations), figure docs
  (attribute timelines; global admin-owned or account-scoped), account docs (defined in
  domain but not yet DO-hosted — see weak points).
- **Dependency direction (hard rule):** `contract → domain`; `web → contract + domain`;
  `worker → contract + domain`. `packages/domain` is pure TS + in-memory Automerge, zero
  I/O. `packages/contract` is Zod schemas + shared types. Nothing imports upward.
- **The store seam:** `apps/web/src/store/` is the only web code allowed to touch
  Automerge or `lib/rpc.ts`. Components consume typed reactive reads. Enforced by
  convention + comments + `routine-store` tests; there is no lint rule — check imports in review.

## 2. Locked decisions digest (`docs/system/architecture.md` § Global constraints, D1–D31 — the authority)

The ~12 most load-bearing, each with the one-line WHY. Decisions marked ⟳v5 were rewritten
2026-07-02. Overriding one is legitimate but goes through an idea doc in `docs/ideas/` (see
`docs/ideas/README.md`), never a silent divergence.

| # | Decision | Why |
|---|---|---|
| **D6** | **Core `@automerge/automerge`**, NOT automerge-repo, behind `store/` | The M0.5 spike proved core + a thin custom DO sync is enough; automerge-repo's sync protocol is adoptable later if delta-efficiency demands it. Don't add it casually. |
| **D10** | **Role-aware read/edit split**: viewers = zero WebSockets (REST snapshot + polling); editors/commenters = one live routine WS; a figure's own WS opens only when its editor opens | Kills per-figure socket fan-out for the dominant read path. **Rejected alternative (recorded in §8):** "read-by-default for everyone, upgrade on first edit" — a passive co-editor on a polled snapshot can't see another editor's edits live; it broke the US-015 convergence journeys. Also locks — **all shipped in PR #134 (2026-07-02)**: snapshot-frame catch-up (one `A.save` blob, never per-change replay), reconnect resend of unacked changes (#161), broadcast-failure → close-for-resync (`SYNC_RESYNC_CLOSE_CODE`). Wire details in **ballroom-flow-crdt-reference** §7. |
| **D12 ⟳v5** | Figures are **live wherever referenced**; editing a *global* figure as a non-admin spawns a **live overlay variant** (per-beat ownership + copy-down); *account* figures edit in place; fork copies account figures, variants stay variants; frozen copies **retired** | Propagation over isolation — the 2026-07-02 reversal of the 2026-06 frozen-copy model. Shipped end-to-end 2026-07-02 (PRs #133/#136/#137): domain helpers, fork, live catalog references, store overlay resolution, snapshot bases. |
| **D13** | **Automerge + a document graph** (one doc per figure/routine), not one big doc | Cross-routine figure inheritance, fork/merge, per-doc history and per-doc permissions all fall out of doc granularity. |
| **D14** | **History-based per-user undo**, no op-log. Soundness (locked 2026-07-02): inverse targets list elements **by id** never index; an already-undone change is never re-selected; figure-editor undo targets **the figure doc** | Op-log undo had three researched blockers (cascading deletes, supersession, per-user dependency); inverting the user's own last change from CRDT history is sound and cheap. |
| **D23** | **One SQLite-backed Durable Object per document**; DO hosts the doc AND is the sync + permission boundary; persist **incremental changes**, compact on alarm | Spike-validated. Full save/load per op was the rejected shape; incremental append + threshold-64 compaction keeps writes cheap. D1 stays a pure index. |
| **D28 ⟳v5** | Global catalog = **real, admin-owned Automerge figure docs**; variants/customs = account-scoped; **library membership = a per-user bookmark** (account `libraryFigureRefs` + D1 `LibraryEntry`) | One shared doc, many bookmarks — no per-user copies of catalog content; "library" is a view, not a scope. |
| **D30 ⟳v5** | Seeder is **additive-only**: one-time import per global figure; thereafter **the doc is the source of truth**; re-running only adds missing figures, never overwrites | Admins edit the catalog in-app; a re-runnable overwrite seeder would silently destroy those edits. |
| **D31** | Admin seams v1 = **`User.isAdmin`** + **`routineCapOverride`** columns only (edits global docs, ops-driven elevation, quota raise). No admin UI until v1.1 | Smallest privileged surface that unblocks v5; the queue/management UI is deliberately deferred. |
| D11 | Roles **viewer/commenter/editor + owner, per document** | Permissions are a document-graph property, matching the DO-per-doc boundary. |
| D21 | Free cap **3 owned routines** behind a quota seam; billing deferred | The seam (`FREE_ROUTINE_CAP`, `routineCapOverride`) is the product decision; billing is not. |
| D7/D8 | **Zod** contract in `packages/contract`; **Drizzle** for D1 | Shared runtime validation web↔worker; typed migrations testable via `applyD1Migrations()`. |

Global constraints (verbatim intent from §8): TS strict, no `any`; canonical state lives in
the Automerge documents; **D1 is a pure index/registry — no op-log, no CRDT content in D1.**

## 3. Invariants that must hold (checkable, with enforcement location)

Before merging any change in scope, walk this table. "Enforced at" = where the rule lives
today; if your change adds a new path, it must re-enforce the rule there.

| Invariant | Enforced at |
|---|---|
| **Soft-delete only** — removal is always a `deletedAt` tombstone, never hard removal, so a concurrent edit on a deleted item still merges (`docs/concepts/notation.md` § The invariants #6–7) | `packages/domain/src/doc-internal.ts` (`isDeleted`/`filterDeleted`); every worker D1 read filters `deletedAt IS NULL`; commenter gate reads with `includeDeleted: true` (`apps/worker/src/doc-do.ts` `commenterChangeAllowed`) |
| **Per-beat variant ownership** (`docs/concepts/figures.md` § Variants, invariants #14–18): a variant owns beat *b* iff it carries any attribute (live or tombstoned) with `floor(count) == b`; owned beat reads wholly from the variant, unowned wholly from the live base; copy-down on first touch; spawning/editing a variant never mutates the base | `packages/domain/src/fork.ts` — `ownedBeats`, `resolveFigure(base, variant)`, `variantAttributesForEdit`, `spawnVariant`; pinned by `fork.test.ts` incl. the Passing Tumble Turn scenario. Wired end-to-end since PR #137: the web store resolves variants on read (`apps/web/src/store/routine.ts` `resolveFigure` :1218 → domain overlay :1233) and the worker snapshot returns variant **bases** for client-side resolution (`index.ts` :751–802) |
| **Builtin attribute slugs are reserved** — a custom kind colliding with a builtin is ignored, builtin wins (`docs/concepts/notation.md` § The invariants #9) | `packages/domain/src/vocabulary.ts` `mergeRegistry`; worker `POST /api/account/custom-kinds` rejects builtin slugs 400 |
| **Dance gates enforced on the write path** — a kind's `appliesToDances` (e.g. `rise` omits Tango) rejects inapplicable writes with `dance_not_applicable`; reads stay forward-compatible (unknown values pass, aliases normalize) | `packages/domain/src/schemas.ts` `parseAttributeWrite` (strict) vs `parseAttributeRead` (lenient); worker `POST /api/figures` uses the strict parse |
| **Permission cascade + owner-without-membership-row**: stored membership wins → document owner is elevated to `owner` even with **no membership row** (#168 — owner must never be locked out) → routine role cascades to referenced figures (editor→editor, commenter/viewer→viewer, most-permissive across routines, never grants delete) | `apps/worker/src/db/membership.ts` `resolveEffectiveRole` → `apps/worker/src/db/placement-edge.ts` `cascadeFigureRole`; gates the DO WS boundary (`doc-do.ts` `fetch`, 403 pre-upgrade) + post-connect via `refreshConnectedRoles` (closes revoked sockets 1008) + the figure REST routes |
| **Permissions live at the DO sync boundary (and REST)** — never post-hoc CRDT cell rejection (rejected as incoherent with CRDT merge; = silent data loss) | `doc-do.ts`: role check before WS upgrade; per-message `canEdit`-or-commenter-classification in `webSocketMessage` |
| **sortKey ordering — never splice**: sections/placements order by a base-62 fractional-index string; a reorder writes the moved item's `sortKey` to a midpoint between neighbours — never remove-and-reinsert (a splice deletes the Automerge object and loses concurrent edits; `docs/system/architecture.md` § Ordering) | `packages/domain/src/order.ts` (`keyBetween`, `sortByOrder` — tie-break by id, array-order fallback for legacy lists); `doc-routine.ts` `readRoutine` sorts on read; convergence proven in `packages/domain/src/convergence.test.ts` |
| **Every D1 query hits an index** — D1 bills rows *scanned*, not returned; a full SCAN is both a perf and a cost bug | `apps/worker/src/test-support/explain.ts` `expectIndexedQuery` (asserts no `SCAN` in `EXPLAIN QUERY PLAN`); runs in the worker suite in CI. Adding a query? Add an index migration + an EXPLAIN test |
| **Canonical state lives in the docs; projections are non-destructive and doc-derived** — D1 rows (registry cards, journal entries, search) are re-derivable from the docs; the alarm projection is one-way and eventually consistent | `doc-do.ts` `alarm` → `projectToD1` / `projectJournalToD1`; D1 tables in `apps/worker/src/db/schema.ts` carry no CRDT content |
| **Components never touch Automerge or the RPC client** — only `apps/web/src/store/` imports `lib/rpc.ts` or `@automerge/automerge` | Convention + `routine-store` tests; verify with `grep -rl "lib/rpc\|@automerge" apps/web/src/components` (matches must be comments only) |
| **Client-generated ULIDs** for all domain ids; DO actor ids are separate (random hex) | `packages/domain/src/ids.ts` `newId()` (sole domain mint point); `doc-do.ts` `newActorId` |

### Design checklist — run this before writing a spec

For any change touching data shape, boundaries, sync, permissions, or module structure:

- [ ] **Where does the canonical state live?** If the answer is "a D1 column", stop — D1 is
      an index. New durable state goes in a doc (or is re-derivable from one). A D1 column is
      correct only for registry/index/projection data (e.g. `isAdmin`, `routineCapOverride`,
      card counts).
- [ ] **New doc field?** It must tolerate old docs that lack it (forward-compatible read),
      never store `undefined` (Automerge throws — see **ballroom-flow-crdt-reference**), and
      deletion must be a tombstone. Consider whether the migration ladder (now wired into the
      DO load path, PR #135) needs a **new** step — never edit an existing one — and say so in
      the spec.
- [ ] **New list or reorder?** Fractional `sortKey` via `keyBetween`, read via `sortByOrder`.
      Never splice.
- [ ] **New D1 query?** Ship the index migration and an `expectIndexedQuery` test in the same
      change.
- [ ] **New route or WS message?** Name the role that gates it and where the gate runs
      (`resolveEffectiveRole` / DO boundary). "The client won't send it" is not a gate.
      Remember the cascade and the owner-without-membership-row rule.
- [ ] **New web feature?** Data access goes through `store/`; UI is prototyped in
      `docs/design/` first (see **ballroom-flow-change-control**); components render from the
      merged ATTRIBUTE_REGISTRY, not hardcoded kind lists.
- [ ] **Touching figures?** Decide explicitly against the v5 model (D12/D28): global vs
      account scope, variant vs in-place edit. New read paths resolve via the domain
      `resolveFigure(base, variant)` overlay (the store and snapshot already do); the legacy
      frozen `copyOnWrite` is read-only for pre-v5 data — never a new write path.
- [ ] **Contradicting a locked decision?** Don't route around it — propose the change as an
      idea doc in `docs/ideas/` (see `docs/ideas/README.md`) in the same PR.

## 4. Known weak points — as of 2026-07-02, HEAD `c9622c9` on `development`

State these plainly in any design that touches them. The v5 milestone is complete except
figure-editor undo — the **single detailed audit** lives in
**ballroom-flow-v5-migration-campaign** §2; here is only what this skill's own invariants
depend on:

1. **Figure-editor undo still targets the routine doc** — the one open roadmap item
   (`docs/README.md`). `apps/web/src/store/routine.ts` `undo()`/`redo()` (:987/:1000) commit
   to `routineConn` only, while `docs/concepts/collaboration.md` § Undo (LOCKED) requires
   "undo follows the surface being edited". Known work, not a regression.
2. **The account-doc CRDT is not wired to a DO** — `packages/domain/src/doc-account.ts` is
   built + tested (family-note mutators AND the v5 `libraryFigureRefs` bookmark helpers),
   but the persisted state today is D1: family notes in their index row, bookmarks in
   `library_entry` (migration 0015) — `docs/system/architecture.md` § D1 — the index &
   projections records this explicitly. Don't delete it as dead code; don't assume
   notes/bookmarks merge like CRDT data until the wiring lands.
3. **Per-document DO fan-out at scale is unmeasured** — explicit watch-item
   (`docs/system/architecture.md` § Non-functional requirements); no load test exists. Step 3
   raised the stakes: the snapshot route now also fans out to each variant's base doc's DO
   (`index.ts` :751–802).
4. **(Resolved 2026-07-05) `main` once diverged from `development` beyond release lag.**
   `main` carried the #83 figure-data merge (9106f63) and its revert (#85, 720103d) plus a
   CLAUDE.md commit (#89) that were not part of `development`'s history. `development` was
   merged into `main` and deleted (PR #161) — **branch off `main` now**; there is no
   integration branch to diverge from (history in **ballroom-flow-failure-archaeology**).

**Recently fixed (do not re-report):** the migrateOnLoad live-doc/persisted-lineage
divergence (`fork.test.ts` "is independent of the origin" red on the tip) was FIXED by
PR #139 (903d109) — `migrateOnLoad` now adopts the migrated doc (`this.doc = fresh`,
doc-do.ts :265). The binding invariant it restored: **the change log must never contain a
change the live doc hasn't applied.** Any new load-path read that persists must also advance
the in-memory doc.

## 5. Where each subsystem lives

| Subsystem | Location |
|---|---|
| Ids (ULID mint), dances, float-count timing | `packages/domain/src/ids.ts`, `dances.ts`, `timing.ts` |
| Fractional-index ordering | `packages/domain/src/order.ts` |
| Roles/capabilities (pure table) | `packages/domain/src/permissions.ts` |
| ATTRIBUTE_REGISTRY + merge + slugs | `packages/domain/src/vocabulary.ts` |
| Attribute read/write validation (Zod) | `packages/domain/src/schemas.ts` |
| Doc schemas + builders/readers | `packages/domain/src/doc-types.ts`, `doc-internal.ts`, `doc-routine.ts`, `doc-figure.ts`, `doc-account.ts` |
| Fork / variants / per-beat overlay (v5) | `packages/domain/src/fork.ts` |
| History-based undo | `packages/domain/src/undo.ts` |
| Migration ladder (runs on the DO load path since PR #135 — `doc-do.ts` `migrateOnLoad`) | `packages/domain/src/migrations.ts` |
| Seed catalog + generated charts | `packages/domain/src/library.ts`, `library-data.ts`, `figure-steps.ts` (pipeline: **ballroom-flow-figure-data-pipeline**) |
| Shared API contract (Zod + the WS wire constants `SYNC_CAUGHT_UP` / `SYNC_FRAME_SNAPSHOT` / `SYNC_FRAME_CHANGE` / `SYNC_RESYNC_CLOSE_CODE`) | `packages/contract/src/index.ts` |
| REST routes + auth + WS handoff | `apps/worker/src/index.ts`; Clerk verify in `apps/worker/src/auth/` (networkless with `CLERK_JWT_KEY`) |
| The Durable Object (persistence/sync/permissions/alarm) | `apps/worker/src/doc-do.ts` (SQLite tables: `changes`, `snapshot`, `doc_meta`) |
| D1 schema + query modules | `apps/worker/src/db/schema.ts` (+ `membership.ts`, `placement-edge.ts`, `routines.ts`, `figures.ts`, `invites.ts`, `journal.ts`, `admin.ts`, `library.ts`, …); migrations in `apps/worker/migrations/` (15 files; 0014 admin cols, 0015 library_entry) |
| Global-catalog seeder (admin-only, additive, D30) | `apps/worker/src/seed-global-figures.ts`; route `POST /api/admin/seed-global-figures` in `index.ts` |
| EXPLAIN no-SCAN gate | `apps/worker/src/test-support/explain.ts` |
| Web store seam | `apps/web/src/store/` (`routine.ts` is the core; `doc-connection.ts` owns WS + heads-keyed materialization) |
| Web components / primitives / tokens | `apps/web/src/components/`, `apps/web/src/ui/`, `apps/web/src/styles/tokens.css` |
| E2E journeys + harness | `apps/web/e2e/` (`serve.sh`, `support/two-users.ts`) |

## Provenance and maintenance

Authored 2026-07-02 against repo HEAD `70eed7e`; refreshed at `3693ff6`; **refreshed again
2026-07-02 — verified at HEAD `759b3a8` (PR #141 figure-editor undo included)** (after PR #139 migrateOnLoad-fix 903d109, PR #136
library-as-bookmark, PR #137 global-figure-docs + admin seams; PR #140 closed as superseded
by #139) on `development` (the branch has since been merged into `main` and deleted,
2026-07-05 — see item 4 above). Verified directly against:
`docs/PLAN.md` v5.0 (§2.5.1 invariants, §5.3, §6, §8 D1–D31, §9) at the time of writing —
since the 2026-07-15 docs restructure, the equivalent material lives in
`docs/concepts/notation.md` § The invariants, `docs/system/architecture.md` § Ordering /
§ Global constraints, and `docs/README.md` (roadmap) — `packages/domain/src/{order,vocabulary,schemas,fork,migrations,doc-account}.ts`,
`apps/worker/src/{index,doc-do,fork,seed-global-figures}.ts`, `apps/worker/src/db/{schema,membership,placement-edge,admin,library}.ts`,
`apps/worker/src/test-support/explain.ts`, `apps/web/src/store/{routine,doc-connection}.ts`,
`packages/contract/src/index.ts`, the 15 files in `apps/worker/migrations/`, and
`git log origin/main`.

Re-verify what drifts:

```bash
# Still the digest of the real locked decisions? (decision table)
grep -n "D28\|D30\|D31" docs/system/architecture.md docs/concepts/figures.md docs/concepts/collaboration.md | head
# Roadmap fully closed? (docs/README.md is now the roadmap pointer — no more §9 checkboxes)
grep -n "roadmap\|Roadmap" docs/README.md
# Migration ladder still on the load path, adopting the migrated doc (#139)?
grep -n "migrateOnLoad\|this.doc = fresh" apps/worker/src/doc-do.ts
grep -n "CURRENT_SCHEMA_VERSION" packages/domain/src/migrations.ts
# Store overlay resolution still live (v5 step 3)?
grep -n "resolveVariantOverlay" apps/web/src/store/routine.ts
# Migration count (15 as of 2026-07-02)
ls apps/worker/migrations/ | wc -l
# Component/store boundary intact (matches must be comments only)
grep -rln "lib/rpc" apps/web/src --include="*.ts*" | grep -v store | grep -v test
```
