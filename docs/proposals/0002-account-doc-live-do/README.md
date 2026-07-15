---
title: Wire the account doc to a live Durable Object
wep: 0002
owning-areas: [worker, domain, web]
authors: ["@danielmschmidt"]
approver: owner
status: implemented
created: 2026-07-13
last-updated: 2026-07-15
see-also: ["PLAN §2.7", "PLAN §9 (2026-07-03 close-out)", "PLAN §11.2", "packages/domain/src/doc-account.ts"]
replaces: null
superseded-by: null
---

# WEP-0002: Wire the account doc to a live Durable Object

*(Seeded from the one recorded v1 engineering gap — PLAN §9's 2026-07-03 close-out deliberately
deferred this as "its own milestone, not a rider on unrelated work". Promoted `provisional →
implementable` 2026-07-13 at the owner's direction, with the Design Details and Test Plan
below completed against the as-built code.)*

## Summary

The per-user **account doc** — the intended CRDT home for `figureType` family notes and
library bookmarks (`libraryFigureRefs`) — exists today only as built-and-tested domain helpers
(`packages/domain/src/doc-account.ts`); the actually-persisted state lives in the D1
projections (`figure_type_note_index` rows carrying content, `library_entry`). This WEP wires
the account doc to a real per-user SQLite-backed Durable Object like every other document:
DO-hosted Automerge doc, owner-only auth boundary, alarm projection into the existing D1
tables (inverting today's write direction), and the web store reading/writing through a
`DocConnection`.

## Motivation

### Goals

- Canonical state for family notes + library bookmarks lives in an Automerge doc, per the
  architecture's global constraint ("canonical state lives in the Automerge documents; D1 is
  a pure index/registry") — currently violated for exactly this document type, by recorded
  deferral.
- Account-doc content gains what every other doc already has: offline editing (the shipped
  §11.2 machinery, for free once it rides `DocConnection`), per-user undo capability, and
  CRDT history.
- One write path: the doc. D1 `library_entry` + `figure_type_note_index` become pure
  alarm-written projections, like `journal_entry` and the registry card columns already are.

### Non-Goals

- **No new user-facing features** — surfaces keep their behavior; this is architecture
  completion. (New *capabilities* that fall out — offline bookmarks/notes — flip existing
  offline affordances but add no new UI.)
- **Custom kinds stay put.** `account_custom_kind` (D1, migrations 0008/0012) remains the
  persisted truth for user-defined kinds; the `AccountDoc.customKinds` field stays dormant.
  Folding them in is a separate decision with its own hybrid-flow implications (PLAN §11.2
  live-gates `createCustomKind`) — a future WEP if wanted.
- **No reply UI for family notes.** `addAccountReply` exists in the domain and the doc will
  carry replies structurally, but no compose surface ships here.
- **No change to note *visibility* semantics** — Q-FIGNOTE-VIS option 2 stands: co-members
  discover notes via the D1 index + co-membership gate on the worker, never by reading
  another user's account doc.

## Proposal

**Named scenario — the coach's family note, offline.** A coach annotates "on every Feather,
keep the head left" (an all-dances `figureType` note) from a practice room with no signal.
Today that write is `POST /api/account/family-notes` → a direct D1 insert — and it fails
offline, because family notes are the one annotation class with no document behind them. With
the account doc live, the note is a CRDT edit to an already-hydrated doc: persisted to
IndexedDB, replayed on reconnect, attributable and undoable — identical to every
routine-scoped note. The coach's student still sees it on their shared routine's Feathers via
the same co-member read as today, because the D1 index row now arrives as an alarm-written
projection of the coach's doc.

**Risk:** this is a hard-gate change end to end (a new DO usage pattern, a new auth boundary,
a projection inversion, a data import) — exactly the class where this repo's worst bugs
lived. It ships alone, not as a rider. Mitigations are designed in below: the boundary is
owner-only (the simplest boundary in the system), the import is gated on an empty DO, and the
projections are full-fidelity so a rollback to D1-as-truth loses nothing.

## Design Details

### Identity & registry

- **docRef = `account:<userId>`** — the synthetic ref `figure_type_note_index.accountDocRef`
  already carries (db/family-notes.ts), now made real. Stable, derivable without a lookup,
  and `DOC_DO.idFromName(docRef)` routes to the DO exactly as for every other doc.
- **One `DocumentRegistry` row per account doc:** `{ docRef: "account:<userId>",
  type: "account", ownerId: <userId>, doName: docRef }`. The `type: "account"` value already
  exists in the schema's documented domain (db/schema.ts).

### Auth boundary — owner-only

`resolveEffectiveRole` already produces the right verdict with **zero new logic**: stored
membership (none exists for account docs) → registry `ownerId === userId` → **owner**; the
`global-figure` special case doesn't apply; the placement-edge cascade is inert for account
refs → any other user resolves **null → 403 before the WS upgrade** (doc-do.ts `fetch`).
This must be pinned by tests, not assumed (see Test Plan). Admins get no special access — an
account doc is private. Invites/memberships on account docs are not supported (the invite
routes gate on roles that no one can hold for these docs).

### DO lifecycle — ensure-then-connect, never post-hoc

A new idempotent `ensureAccountDoc(env, userId)` (worker), following the repo's
mint + project + **seed the DO first** rule and the `ensureGlobalFigures` self-healing
precedent:

1. If the registry row exists → done (fast path, one indexed PK read).
2. Else: read the user's live D1 rows — `library_entry` (`deletedAt IS NULL`) and
   `figure_type_note_index` rows where `authorId = userId` — build the initial `AccountDoc`
   via a pure domain builder (`importAccountDoc(rows)`, new in `doc-account.ts`; **reuses
   the existing ULID `noteId`s** so identities survive the import), `seedDoc` it into the
   DO **stamped `CURRENT_SCHEMA_VERSION`, under the fixed migration actor** (never a user's
   undo target), then insert the registry row.
3. Called lazily from the account-doc write/read seams (the connect route's account branch
   and the transitional REST shims below) — no bulk backfill job; a user's doc is minted on
   their first touch. The import is **gated on the registry row's absence**, so a
   re-forward after a rollback can never re-import stale D1 over a newer doc.

The DO's existing machinery applies unchanged: incremental change persistence, threshold
compaction, hibernatable WS, `migrateOnLoad` (shape-agnostic — reads only `schemaVersion`),
post-connect `refreshConnectedRoles`.

### Write-path inversion

- **The store** opens the account doc through `DocConnection` **lazily** (D10 discipline —
  no eager socket per session): on opening the Library screen, the family-note compose, or
  the Journal's authoring surfaces. Mutations call the existing domain helpers
  (`addLibraryRef` / `removeLibraryRef` / `addFamilyNote` / `softDeleteAccountAnnotation`)
  through the seam; components stay behind `apps/web/src/store/` as always.
- **REST routes become transitional shims** in the same change:
  `POST/DELETE /api/figures/save-to-library` and `POST /api/account/family-notes` stop
  writing D1 directly and instead apply the equivalent doc edit via a DO RPC
  (`ensureAccountDoc` + an `applyAccountEdit` entrypoint on the DO), so a stale tab (the
  only cross-version peer — §7 rollout skew) keeps working and **there is exactly one D1
  writer: the alarm projection**. Route removal is a later cleanup once the store no longer
  calls them.
- **Reads split by audience** (this resolves the eventual-consistency question):
  - *Self* reads live from the doc: the Library screen's bookmark set and the user's own
    family notes come from the account `DocConnection` (referentially stable via the
    existing `reconcile` materializers), so "add to my library" is visible instantly and
    offline. `GET /api/figures/mine` remains for registry-metadata joins; the client merges
    it with the live bookmark set.
  - *About-others* reads stay on the projections, unchanged: co-member family notes
    (`GET /api/routines/:id/family-notes` over `figure_type_note_index`) and the Journal's
    account arm. These were already eventually consistent in spirit (journal_entry is); the
    alarm keeps the lag to its existing compaction cadence.

### Projection — alarm-written, non-destructive, doc-derived

The account DO's `alarm` projects, exactly as routine DOs project `journal_entry`:

- **`library_entry`:** upsert a live row per `libraryFigureRefs` entry; tombstone
  (`deletedAt`) rows whose ref left the set — never hard-delete. Idempotent: a doc matching
  its projection writes nothing.
- **`figure_type_note_index`:** upsert one row per non-tombstoned `figureType` annotation
  (content included — the v1 "carries content" shape is kept; thinning the index is out of
  scope); tombstone rows whose note is tombstoned in the doc. Reused `noteId`s make this a
  stable-key upsert, not a wipe-and-rewrite.

Both projections preserve the invariant that D1 rows are re-derivable from docs. New
projection/import queries ship with `expectIndexedQuery` tests (`library_entry`'s
`(userId, figureRef)` PK and `figure_type_note_index`'s existing author/danceScope indexes
cover the access paths; any gap gets an index migration in the same change).

### Offline & undo

- Riding `DocConnection` enrolls the account doc in the shipped §11.2 machinery unmodified:
  IndexedDB persistence, replay-on-reconnect, the `local` edit-gate state. The offline
  affordances flip accordingly: **bookmark add/remove and family-note authoring work
  offline once the doc is hydrated**; `PLAN §11.2`'s live-gated list is updated in the
  implementing change (bookmarks and family notes leave it; custom kinds stay).
- Undo capability comes from history + per-tab actors as on figure docs; **no new undo UI**
  ships (surface-follows-focus stays as is — a dedicated library-screen undo affordance
  would be its own design-bundle-first change).

### Migration, back-compat, rollback

- **Forward:** lazy per-user import as above; no data migration for routine/figure docs; no
  contract-breaking API change (shimmed routes keep their signatures, incl. save-to-library's
  `{ alreadySaved }` response derived from the doc state).
- **Skew:** worker + SPA deploy atomically; stale tabs hit the shimmed routes, which write
  through the doc — one write path even mid-rollout.
- **Rollback:** projections are full-fidelity, so reverting the deploy reverts to
  D1-as-truth with current data; docs go stale during the rollback window and are **not**
  re-imported over (import only fires when the registry row is absent). A post-rollback
  re-forward requires an explicit ops decision if doc-vs-D1 divergence occurred; the WEP's
  implementing PR documents this in OPS.md.

## Test Plan

TDD, unskip/write-first, per `docs/TEST-MAP.md` conventions (new rows added there in the
implementing PRs):

- **Domain** (`packages/domain`): `importAccountDoc` builder — pure, deterministic, reuses
  noteIds, tombstone-safe, stamps `CURRENT_SCHEMA_VERSION`; existing `doc-account.test.ts`
  coverage extends (lenient reads already pinned).
- **Worker / DO** (`vitest-pool-workers`; unique DO ids, `isolatedStorage: false`):
  - Boundary: owner connects (101); a *different authenticated user* is rejected **403
    pre-upgrade**; admin is rejected too (no special access); the routine→figure cascade
    grants nothing for an account ref.
  - `ensureAccountDoc`: mints registry row + seeded doc from D1 rows; idempotent (second
    call is a no-op); import never runs when a registry row exists.
  - Persistence: account doc survives DO eviction/reload; `migrateOnLoad` upgrades a
    stale-schema account doc under the migration actor.
  - Projection: doc → `library_entry`/`figure_type_note_index` parity, including tombstone
    transitions both ways and idempotence (re-run alarm → zero writes); co-member read
    (`familyNotesForMembers`) returns identical results before/after inversion.
  - `applyAccountEdit` shims: REST bookmark/note calls produce doc edits (not direct D1
    writes) with unchanged response shapes.
  - `expectIndexedQuery` on every new/changed query.
- **Component** (browser + axe): Library screen reads the bookmark set through the store
  seam (instant after add, no refetch dependency); family-note compose in the `local`
  offline state.
- **E2E**: the ship-gate journey below.

Coverage: worker threshold (≥88 lines, ratcheting) must hold with the new modules included.

## Ship Gate

**`apps/web/e2e/account-doc.spec.ts` (@smoke), green on the implementing PR:**

1. A family note authored **offline** survives a reload while offline and replays on
   reconnect, appearing exactly once (the offline-editing.spec pattern applied to the
   account doc).
2. A bookmark added offline shows in the Library immediately and round-trips to
   `GET /api/figures/mine` after reconnect + projection.
3. **Visibility unchanged:** a co-member on a shared routine sees the family note on its
   matching figure; a non-member does not.

Marking this WEP `implemented` additionally requires, in the same change: PLAN §2.7
(projection wording), §9 (the recorded gap closes), §11.2 (live-gated list) updated;
`doc-account.ts`'s STORAGE NOTE rewritten to as-built; TEST-MAP rows added; OPS.md rollback
note added; this WEP's front-matter + the CLAUDE.md index row flipped together.

## Drawbacks

- One more DO per active user (hibernatable, lazy socket — negligible cost, but the
  per-document fan-out watch-item in PLAN §12 gets one more contributor).
- A data import path and a projection inversion for a feature set that, today, works —
  risk now for capability later (offline/undo/history) plus the removal of a standing
  architecture violation.
- The transitional REST shims mean a short period with two *entry* points (store + shim)
  into the one write path; cleanup is a follow-up deletion.

## Alternatives

- **Leave it as is** (D1 rows as truth, helpers dormant). Zero risk now, but the
  architecture constraint stays violated, family notes stay the one non-offline annotation,
  and the dormant helpers rot. Rejected by promoting this WEP — staying put stops being a
  decision and becomes drift.
- **Drop the account-doc concept; bless D1 as truth for account state.** Honest and
  smaller — but it forks the architecture ("canonical state in Automerge docs, *except*
  account state"), forecloses offline/undo for that state, and reverses the recorded intent
  in `doc-account.ts`'s STORAGE NOTE. Would need its own WEP reversing a global constraint.
- **Synchronous D1 writes from the DO on every change** (instead of alarm projection).
  Tighter read-your-writes for `/api/figures/mine`, but it diverges from the established
  projection pattern (journal, registry cards), doubles write amplification on chatty
  edits, and the self-read problem is better solved at the source — the client reads its
  own doc. Rejected.
- **Bulk backfill migration for all users at deploy time.** Deterministic cutover, but it
  needs a migration runner the platform doesn't have (no queue in v1), and lazy per-user
  ensure matches the self-healing precedent (`ensureGlobalFigures`) with the same
  idempotence guarantee. Rejected.
