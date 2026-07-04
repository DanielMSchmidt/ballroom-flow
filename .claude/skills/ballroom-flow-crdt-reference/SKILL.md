---
name: ballroom-flow-crdt-reference
description: Load when work touches Automerge documents, sync, convergence, undo, variants, or list ordering in weave-steps and you haven't internalized CRDT reasoning — how docs/changes/heads work, the five Automerge 3.x sharp edges, the identity-vs-position cardinal rule, fractional-index ordering, per-beat overlay variants, history-based undo, and the WS sync protocol as built. Symptoms: "outdated document" RangeError, "Cannot assign undefined value", byte-comparison convergence failures, lost concurrent edits, undo deleting a peer's element, catch-up/hydration questions.
---

# Automerge / CRDT reference — as used in weave-steps

This is the CRDT reasoning skill: Automerge from first principles, then exactly how this
repo uses it. Every claim below was verified against the repo on 2026-07-02.

**When NOT to use this:**
- Locked architecture decisions and their rationale (why Automerge, why per-doc DOs, D10/D12/D13/D14) → **ballroom-flow-architecture-contract**.
- Property-test recipes for convergence/commutativity/idempotence → **ballroom-flow-proof-and-analysis**.
- Debugging a live sync/permission failure → **ballroom-flow-debugging-playbook**; past incidents in depth → **ballroom-flow-failure-archaeology**.
- The v5 live-figure migration work itself (what to build next) → **ballroom-flow-v5-migration-campaign**.

---

## 1. Mental model (60 seconds)

- An **Automerge doc** is an immutable value plus its full **change history**. `A.change(doc, fn)` returns a *new* doc with one appended **change**.
- Every change carries: an **actor id** (a hex string identifying who authored it — per-user/per-connection here), a per-actor **seq**, a **hash**, and **deps** (the hashes of the changes it causally builds on). The deps form a **DAG** — Automerge's equivalent of a git commit graph.
- The **heads** of a doc (`A.getHeads(doc)`) are the DAG's current leaves — a set of hashes that uniquely identifies a logical state.
- **Convergence** is set semantics: two replicas holding the *same set of changes* are in the *same logical state*, no matter what order the changes arrived in. That is the entire correctness contract of the sync layer — merge/apply order must not matter, duplicates must be no-ops.
- Corollaries this repo leans on everywhere:
  - Equality of state = equality of **sorted heads**, never equality of bytes (§2, edge 3).
  - A relay can be dumb: forward change bytes to everyone, apply idempotently (`apps/worker/src/doc-do.ts` `ingestChange`).
  - "Undo" cannot rewrite history — it must be a *new* change that merges like any other (§6).

Define once: **tombstone** = soft-delete marker (`deletedAt: <timestamp>`); a tombstoned entity stays in the doc and readers filter it (`packages/domain/src/doc-internal.ts` `isDeleted`/`filterDeleted`).

---

## 2. The five Automerge 3.x sharp edges

All five are documented in `docs/DEVELOPMENT.md` ("conventions that bite") and enforced by helpers. Symptom → rule:

| # | Symptom | Rule | Where enforced |
|---|---|---|---|
| 1 | `RangeError: Cannot assign undefined value at /path` at `A.from` or inside `A.change` | Automerge **cannot store `undefined`**. Strip `undefined`-valued keys before writing; **`null` is preserved** (`deletedAt: null` is a meaningful CRDT value, not an absent field). | `stripUndefined` in `packages/domain/src/doc-internal.ts:19`; every builder goes through `buildDoc` |
| 2 | `RangeError: Attempting to change an outdated document. Use Automerge.clone()` | A doc reference is **consumed** by `change`/`merge`/`applyChanges` — the old reference is "outdated". `A.clone(base)` before reusing a doc as the base for a second independent lineage (two replicas from one fixture, a what-if apply). | `applyMutations`/`exchangeAndAssertConverged` in `packages/domain/src/__fixtures__/convergence.ts`; `commenterChangeAllowed` clones before its trial apply (`doc-do.ts:586`) |
| 3 | Two converged docs fail a byte comparison | `A.save()` bytes are **NOT canonical across merge order** — identical logical state can serialize differently. Assert convergence via **sorted `getHeads`**. Byte equality is valid only for a single-doc save/load round-trip. | `assertHeadsEqual` (heads) vs `assertBytesEqual` (round-trip only) in `__fixtures__/convergence.ts:136/:146`; `headsEqual` in `doc-do.ts:74` |
| 4 | "Just delete the row" | **Tombstones, never hard deletes.** A hard removal cannot merge with a concurrent edit to the same entity (the edit resurrects nothing / targets nothing — divergent intent). A tombstone is a field write: the concurrent edit and the delete both land, readers resolve (`deletedAt` wins the display). Also load-bearing for variants (§5: a tombstoned attribute still claims its beat) and undo (nothing is ever unrecoverable). | `softDelete*` everywhere in `packages/domain/src/doc-*.ts`; repo-wide rule in CLAUDE.md §4 |
| 5 | Slow test collection / bundle-size questions | Automerge is a **WASM module** (~2.6 MB raw; the bulk of the app's 920 KiB-gzip worker bundle, spike-measured — `docs/spike/SPIKE-FINDINGS.md`). It loads once per process. Never top-level-import it from a skipped test suite: use the dynamic-import pattern (`loadAutomerge` in `__fixtures__/convergence.ts`) or `import type`. | fixture pattern + CLAUDE.md §4 "never top-level-import a not-yet-built export" |

---

## 3. THE cardinal lesson: identity, never position

**Rule: never address an Automerge list element by numeric index across time.** An index is only
valid at the exact historical state it was computed against; any concurrent change invalidates it.
This repo was bitten twice (see **ballroom-flow-failure-archaeology** for the full incidents):

**Incident 1 — reorder as splice (internal ledger #63; fixed PR #107, commit 38dfba7).**
Moving a placement was implemented as delete-at-index + reinsert-a-plain-JSON-copy. Single-client
correct; under concurrency the moved object was *deleted*, so a peer's concurrent edit to it was
lost, and two concurrent splices clobbered each other's order. Fix: reorder became a **field
update** — set the moved item's `sortKey` (§4). The object is never deleted, so concurrent edits
to it survive, and two concurrent `sortKey` writes merge per-field with a deterministic outcome.

**Incident 2 — undo replayed historical indices (fixed commit 3725ec9, PR #132).**
`A.diff` inverse patches carry list indices valid *at the historical state*. Replaying them
positionally against the *current* (merged) doc deleted a concurrent peer's element (A and B both
insert at index 0 → A's undo removes B's item). Fix: simulate the inverse against the exact
historical state (`A.view(doc, [hash])`), record **identity-anchored ops** (element `id`s), apply
those to the live doc — a moved element is found by id; a gone element makes the op a no-op (§6).

Both fixes are the same idea: convert positional intent into identity intent before it crosses time.

---

## 4. Fractional-index ordering (`packages/domain/src/order.ts`)

Every section and placement carries an opaque `sortKey` string; lists are read in lexicographic
`sortKey` order. Vendored ~40-line midpoint construction over a **base-62** alphabet
(`0-9A-Za-z`) — deliberately no `fractional-indexing` npm dep.

| Function | Contract |
|---|---|
| `keyBetween(a, b)` | Key strictly between `a` and `b`; either bound may be `null` (open end). `keyBetween(null, null)` = stable mid-range starter; `keyBetween(last, null)` appends. Throws if `a >= b`. |
| `sequentialKeys(n)` | `n` deterministic ascending keys — seeding/migrating a list. Deterministic matters: every replica backfilling the same array order assigns identical keys, so the backfill itself converges. |
| `sortByOrder(items)` | Ascending by `sortKey`, tie-broken by `id` (total determinism). **Fallback:** if ANY item lacks a `sortKey`, returns existing array order (legacy docs read as authored). |
| `ensureSortKeys(items)` | Backfills keys **only when the whole list lacks them** (fully-legacy doc); a partially-keyed list is left untouched. Mutates in place — call inside an Automerge change. |
| `keyForMove(sorted, from, to)` | The key that lands the item between the two neighbours straddling destination index `to` in the CURRENT sorted order. Returns `null` for no-op/out-of-range. |

**Invariant: a key never ends in the zero digit (`"0"`).** This guarantees a strict midpoint
always exists between any two keys (there is always room to descend below). If you ever mint keys
by hand, preserve it.

Backfill paths: `addSection` (`packages/domain/src/doc-routine.ts`) backfills-then-appends, and
the v3→v4 migration (`packages/domain/src/migrations.ts`) backfills. As of PR #135 (2026-07-02)
the migration ladder **runs on the DO load path**: `doc-do.ts` `migrateOnLoad` applies
`migrateDraft` inside an `A.change` attributed to a fixed `MIGRATION_ACTOR` (never a user's, so
per-user undo can't select it), persists the upgrade, and — since the PR #139 lineage fix
(903d109) — **adopts the migrated doc** (`this.doc = fresh`), so the persisted change log and
the live doc never fork. Every seed site stamps `CURRENT_SCHEMA_VERSION`. The `sortByOrder`
fallback + `ensureSortKeys` remain as read-side defence.

---

## 5. Per-beat overlay variants (`packages/domain/src/fork.ts`, PLAN §5.2, ⟳v5)

v5 model (2026-07-02): figures are **live wherever referenced**. A non-admin editing a **global**
(catalog) figure spawns a **variant** — an account figure whose `baseFigureRef` is a *live* link.
The variant stores only what it owns; everything else resolves live from the base, so catalog
improvements keep flowing into untouched beats (the "Passing Tumble Turn" scenario that decided
the model).

Ownership granularity is the **whole beat**: beat `b` covers counts `[b, b+1)` including sub-beat
slots e/&/a; `beatOf = Math.floor(count)`.

| Function (fork.ts) | Semantics |
|---|---|
| `ownedBeats(variant)` :117 | The beats the variant carries ANY attribute on — **live OR tombstoned**, either role. A tombstoned attribute still claims its beat (that's how "delete a base value" is representable). |
| `resolveFigure(base, variant)` :132 | Per-beat merge: an **owned beat reads wholly from the variant**; an **unowned beat reads wholly from the live base**. Attributes sorted by count. `bars` and entry/exit alignment fall back to the base when the variant hasn't authored its own. Pure, operates on plain snapshots; tombstone-dropping stays the reader's concern. A standalone figure (no base) is its own resolution. |
| `variantAttributesForEdit(base, edited)` :166 | Copy-down on first touch. The editor edits the RESOLVED timeline and hands back the whole intended content; per beat: unchanged-vs-base → store nothing (stays live); changed → store the edited beat verbatim (beat becomes owned); **cleared entirely → store TOMBSTONED copies of the base's attributes** (an empty owned beat is otherwise unrepresentable). Content comparison key = `kind\|count\|role\|value` (ignores `id`/`deletedAt`). |
| `spawnVariant(placement, globalFigure, byUser, edited?)` :205 | New account figure owning only the edited beats (none if `edited` omitted), `baseFigureRef` = live link, placement re-pointed. The base is never mutated. `bars`/alignment NOT copied (resolve live until authored). |
| `copyFigureForFork(figure, byUser)` :237 | Choreo fork: account figures are copied so the fork is independent of the ORIGIN — but **a variant is copied AS a variant** (same `baseFigureRef`, same owned beats), so catalog flow-in continues. Global refs are NOT copied — the fork keeps them live. |
| `copyOnWrite` :72 | **LEGACY** pre-v5 frozen-copy path, retained read-only for existing data. New divergence goes through `spawnVariant`. |

**v4 back-compat (no data migration, PLAN §9):** an existing v4 frozen copy has content on every
beat it uses, so it *owns every beat it has content on* — `resolveFigure` returns exactly its
current timeline. Its `baseFigureRef` becoming live changes nothing until the catalog adds values
on beats the copy never touched.

**The two `resolveFigure`s, and where resolution RUNS (since PR #137, v5 step 3 ✅).** The
domain one above is the pure overlay resolver; the web store has a private same-named function
(`apps/web/src/store/routine.ts:1218`) that now **calls it**: a figure with a non-null
`baseFigureRef` is resolved per-beat via `resolveVariantOverlay` (the aliased domain import,
routine.ts:37; call at :1233), with the base's content supplied by `resolveBaseContent`
(:1165 — an OPEN live base connection first, else the routine snapshot's `bases`, else the
bundled catalog for a `global:` ref). A standalone figure — a catalog reference, a
from-scratch custom, or a legacy full copy that owns all its beats — is its own resolution.
The worker snapshot (`apps/worker/src/index.ts` :751–802) returns each variant's base doc in
`bases` so the client can resolve. Fork v5 (step 5, PR #133): `apps/worker/src/fork.ts`
copies referenced account figures via `copyFigureForFork` (variants stay variants) and leaves
global refs live.

---

## 6. History-based per-user undo (`packages/domain/src/undo.ts`, PLAN §5.4, D14)

Automerge has no per-user UndoManager. Undo here = find the user's own last change in history,
compute its inverse, apply the inverse as a **new, mergeable change**. No op-log, no external
stack — the entire undo/redo state machine lives in **change messages**, so it survives reloads
and merges like everything else.

Pipeline of `undoLastChange(doc, actorId)` (:399):

1. **Select target**: filter `A.getAllChanges` by `actorId`, oldest→newest by seq; pick the newest
   *editing* change (not an undo/redo message) that is not already reverted.
2. **Reverted-ledger**: each undo change carries the message **`ballroom:undo:<hash>`** naming the
   change it reverted; each redo carries `ballroom:redo:<undoHash>`. `revertedSet` replays these
   messages to know what is currently reverted — so **a change is reverted at most once**; a
   second undo press walks back to the previous change, and a press with nothing left is a no-op.
   (Soundness rule 2 — re-inverting the same change was destructive; fixed 3725ec9.)
3. **Invert at historical coordinates**: `A.diff(doc, [target.hash], target.deps)` yields
   after→before patches whose list indices are valid only at that historical state. Simulate them
   against `A.toJS(A.view(doc, [target.hash]))` — where the indices are exact — and record
   **identity ops** (remove element with id X; insert after element with id Z; set field F on
   object with id X).
4. **Apply identity ops to the live doc** in one `A.change` tagged `ballroom:undo:<hash>`. Against
   the live draft, list steps resolve **by element id only** — a missing element (a concurrent
   peer removed it) makes that op a silent no-op; positional fallback is exactly the corruption
   this exists to prevent. (Soundness rule 1, §3.)

Related pieces:

- `wasSupersededByOthers(doc, actorId)` (:441) — the **soft hint, never a blocker**. Walks the
  real dep DAG forward from the undo target: true iff a *different* actor's change causally
  depends on it ("built on" — exact relation, not a heuristic). A purely concurrent edit is NOT
  flagged. The UI only softens the toast; undo always proceeds. Call it on the **pre-undo** doc
  (the undo itself perturbs the graph — see `apps/web/src/store/routine.ts:987-999`).
- `redoLastChange` (:486) — only if the actor's **last** change is an undo (1-deep toggle); a
  fresh edit clears redo. It must not blindly invert the last change or it would delete that edit.
- Known accepted limit (Q-UNDO): undoing a write to a cell another actor *concurrently* also
  wrote restores the old value, superseding theirs — the CRDT merges, no refusal; disjoint
  concurrent edits survive untouched.
- Actor plumbing: the store uses a **stable per-tab actor id** so the same actor authors and
  undoes (`routine.ts:406`); DO-side mutations use a per-connection actor from the socket
  attachment, never the DO's own actor (`doc-do.ts` `newActorId` — 16 random bytes as **hex**;
  Automerge rejects non-hex actor ids like dashed UUIDs).
- **Figure-scoped undo (PR #141, `e14c5cb`): SHIPPED.** `undoFigure`/`redoFigure`
  (`routine.ts:260/:1025`) invert this tab's actor's last change on the **figure's own**
  `DocConnection`; figure connections seed with the per-tab actor so figure edits are
  attributable. Routine-level `undo()`/`redo()` still target the routine doc — undo follows
  the surface being edited (§5.4).

---

## 7. The sync protocol as built (post-#134, 2026-07-02)

One Durable Object per document; one WebSocket per doc per client. The wire is **asymmetric**
(`packages/contract/src/index.ts` :149–195): **server→client binary frames carry a 1-byte type
tag** — `SYNC_FRAME_SNAPSHOT` (0x01, :183 — the whole doc as one `A.save` blob) or
`SYNC_FRAME_CHANGE` (0x02, :184 — one incremental change) — while **client→server frames stay
raw Automerge change bytes**;
plus the `SYNC_CAUGHT_UP` text marker. This was a **hard protocol cutover** (PR #134): an old
client against a new server drops the tagged frames until reload — accepted; a WS-subprotocol
version (`ballroom.sync.v2`) is the recorded escape hatch if a zero-downtime rollout is ever
needed. Server: `apps/worker/src/doc-do.ts`; client: `apps/web/src/store/doc-connection.ts`;
upgrade route: `apps/worker/src/index.ts` (`/docs/:id/connect`).

**Connect + auth.** A browser WS handshake can't set `Authorization`, so the client offers the
Clerk token as a WS subprotocol: `Sec-WebSocket-Protocol: ballroom.auth, <token>`
(`AUTH_SUBPROTOCOL` in both `doc-connection.ts:37` and `index.ts:878`). The worker route extracts
it → `Authorization: Bearer` header → the DO authenticates fail-closed (401 no/bad token, 403
non-member) *before* accepting the socket, and echoes the subprotocol on the 101 (browsers require
it). The resolved role + verified `sub` + a fresh actor id ride the hibernation-safe
`SocketAttachment`.

**Catch-up.** On accept, the DO sends the new socket **ONE `SYNC_FRAME_SNAPSHOT` frame** (an
`A.save` blob of the whole doc — bounded on the wire, unlike the pre-#134 per-change replay,
which grew without bound as a doc aged), then the text marker **`SYNC_CAUGHT_UP` =
`"ballroom:sync:caught-up"`** (`packages/contract/src/index.ts:149`; sent at `doc-do.ts`
:511–522). The client `A.load`s the blob and **`A.merge`s** it into its local doc
(`mergeSnapshot`, `doc-connection.ts:385`) — merge is a union, so a reconnecting client's
unacked local edits survive; it then diffs `A.getChanges(serverDoc, merged)` and **re-sends
the changes the server lacks** (reconnect resend, internal #161; idempotent server-side). An
unseeded doc sends no snapshot, just the marker; in that case the client resends
`getAllChanges` at `SYNC_CAUGHT_UP`. The client stays `"connecting"` until the marker arrives,
then goes `"live"` = **hydrated, safe to edit** — socket-open is NOT hydrated (the #202 lesson:
flipping live on open let clients edit a not-yet-replayed doc). `DocConnection.onceLive()`
defers seed writes accordingly. Catch-up reads via `loadPersisted()`, never `getDoc()`, so
connecting to an unseeded doc does NOT persist an empty placeholder (which used to trip the
seed's no-clobber guard).

**Seeding.** `seedDoc(content)` (`doc-do.ts:294`) is called by the create routes (and the
admin catalog seeder) so initial
content is server-persisted the instant the doc exists (client-written seeds were lost on
immediate reload). **No-clobber**: a no-op if any snapshot/changes already exist. It also
**broadcasts** the seed to already-connected sockets (a collaborator who connected pre-seed would
otherwise stay empty until reload).

**Ingest + relay.** `ingestChange` (`doc-do.ts:363`) applies a frame, and persists + relays it
**only if heads changed** (`headsEqual` :74, order-independent) — duplicate delivery is a
wire-level no-op, which is what makes dumb relaying safe (and what makes the client's reconnect
resend safe). Malformed frames throw inside Automerge and are dropped. **Standing caveat:**
"heads unchanged" also swallows a change whose **deps are missing** (Automerge defers it) —
the mechanism behind the 2026-07-02 migrateOnLoad lineage-divergence incident, **fixed by
PR #139** (903d109: `migrateOnLoad` adopts the migrated doc, so the change log never contains
a change the live doc hasn't applied — keep it that way on any new load path; see
**ballroom-flow-debugging-playbook** row 12). An Automerge `patchCallback` cheaply detects
annotation-touching changes to arm the journal projection (no full-doc JSON diff on the hot
path). Relays go out as tagged `SYNC_FRAME_CHANGE` frames (`broadcast`, `doc-do.ts:721`); a
**failed `send` closes that socket** with `SYNC_RESYNC_CLOSE_CODE` (4001, contract :195) — the
client treats a close-after-open as a warm drop, auto-reconnects, and recovers the missed
change from a fresh snapshot (no silent divergence).

**Write gating (defence in depth past the connect check).** In `webSocketMessage`: editors/owners
(`canEdit`) pass; a **commenter** passes only `commenterChangeAllowed` (:579) — the frame is
trial-applied to a **clone** and classified **by effect**, never by a client-declared label:
(1) structure outside `annotations` must be byte-identical (compared with tombstones included, so
a structural soft-delete still counts as structural); (2) authorship is checked against the
socket's **verified `sub`**, never the client-controlled `authorId` — created annotations/replies
must be the commenter's own; another author's annotation may only gain the commenter's replies;
hard removals never pass. Viewers are read-only. `refreshConnectedRoles()` re-resolves every open
socket's role from D1 after any membership write and closes revoked sockets with code 1008 — a
role is not frozen at handshake (the 99fa1b9 fix).

**Client resilience** (`DocConnection`): capped-backoff auto-reconnect (warm drops — including a
server-initiated `SYNC_RESYNC_CLOSE_CODE` close — retry forever; cold handshake failures give up
after `maxColdAttempts` → terminal `"closed"`, recoverable via `reconnectNow()`); fresh token per
(re)open; local changes made while not-open are **buffered and flushed on open** (`pendingSends`
:118), and changes the server never saw are **re-sent from the snapshot diff on reconnect**
(`resendMissing` :424 — the #161 core); unknown-tag binary frames are dropped (that's what an
old server's untagged frames look like); `materialized()` memoizes `A.toJS` **keyed by heads**
so unrelated sync frames don't churn object identity (the editor-flicker fix — prefer it over
`A.toJS(conn.current())` on any hot read path).

**Shipped 2026-07-02** (the former D10 open gaps — snapshot-frame catch-up, reconnect resend,
broadcast-failure resync in PR #134; migration ladder on the DO load path + fresh docs stamped
`CURRENT_SCHEMA_VERSION` in PR #135 + the #139 lineage fix; v5 steps 3/4/6 in PRs #136/#137).
Figure-editor undo landed in PR #141, closing the milestone — the audit lives in
**ballroom-flow-v5-migration-campaign** §2; check there before assuming state.

---

## Quick self-check before you write CRDT code here

- [ ] Am I addressing any list element by index across time? (→ §3: use ids / sortKey.)
- [ ] Am I reusing a doc reference after `change`/`merge`/`applyChanges`? (→ clone first.)
- [ ] Am I comparing `save()` bytes to assert convergence? (→ sorted heads / `assertHeadsEqual`.)
- [ ] Could this value be `undefined` when it reaches Automerge? (→ `buildDoc`/`stripUndefined`; keep `null`.)
- [ ] Am I hard-deleting anything? (→ tombstone.)
- [ ] Does my new write path work when the same change arrives twice, or two clients do it concurrently? (Write the convergence property test — see **ballroom-flow-proof-and-analysis**.)
- [ ] Am I treating socket-open as hydrated, or a checked-once role as permanent? (→ §7.)

## Provenance and maintenance

Authored 2026-07-02 against repo HEAD `70eed7e`; refreshed at `3693ff6`; **refreshed again
2026-07-02 — verified at HEAD `759b3a8` (PR #141 figure-editor undo included)** (after PR #139's migrateOnLoad lineage fix and PRs
#136/#137 — store overlay resolution, snapshot bases, global-figure boundary) on
`development`. Verified directly against:
`packages/domain/src/{fork,order,undo,doc-internal,migrations}.ts`, `packages/domain/src/__fixtures__/convergence.ts`,
`apps/worker/src/doc-do.ts`, `apps/worker/src/index.ts` (connect route), `apps/web/src/store/{doc-connection,routine}.ts`,
`packages/contract/src/index.ts`, `docs/DEVELOPMENT.md`, `docs/PLAN.md` §5.2/§5.4/§9/D10-D14,
`docs/spike/SPIKE-FINDINGS.md`. Incident hashes (38dfba7, 3725ec9, 99fa1b9, 903d109, PR
#107/#132–#137/#139) from git history; "#63/#161/#202" are the repo's internal ledger numbers
(they do NOT resolve on GitHub). PR #140 was closed as superseded by #139.

Re-verify drift-prone facts:

```bash
grep -n "SYNC_CAUGHT_UP\|SYNC_FRAME_\|SYNC_RESYNC" packages/contract/src/index.ts  # wire constants
grep -n "this.doc = fresh" apps/worker/src/doc-do.ts               # the #139 adopt still in place
grep -n "COMPACT_THRESHOLD" apps/worker/src/doc-do.ts              # compaction bound
grep -n "resolveVariantOverlay" apps/web/src/store/routine.ts      # store overlay resolution live
grep -n "☐" docs/PLAN.md | head                                    # remaining open box(es)
grep -n "ballroom:undo" packages/domain/src/undo.ts                # undo message tags
grep -n "never ends in the zero digit\|ZERO" packages/domain/src/order.ts
```
