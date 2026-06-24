# Extensibility Review — v1 (online-only) → v2 (offline-first / CRDT)

**Reviewer angle:** one axis only — does the v2 spec keep the CRDT/offline door genuinely open, or quietly paint into a corner?
**Target:** `docs/superpowers/specs/2026-06-24-ballroom-flow-design.md` (§2 entities/IDs, §5.4 concurrency/LWW/op-log, §7 architecture, §10 out-of-scope).
**Context:** `research/platform.md` §2 (TinyBase MergeableStore, Yjs, fractional indexing, DOs); `research/critique-sync.md` (the prior LWW-per-cell / migration / move-across-parent critique).
**Date:** 2026-06-24.

---

## Verdict (read this first)

**The v1→v2-CRDT path is _mostly_ a clean additive path, but only because v1 already made the two most expensive structural decisions correctly: it chose `sortKey` fractional indexing (CRDT-ready) and it chose an explicit op-log. Three cheap-now omissions, if left, turn the "additive" claim into a partial rewrite of the persistence and ID layers.** None of the three are large; all are far cheaper to fix in the spec today than after data exists in clients.

The three corners, ranked:
1. **[BLOCKER] Entity IDs are not stated to be client-generated.** This is the one that, left unfixed, forces a data-migration of every row and FK in v2. Cheapest possible fix now, catastrophic later.
2. **[MAJOR] No `schemaVersion` on persisted/exported data.** Export/import exists in v1 (§8) and the CRDT comes later; both need a version stamp the moment any data leaves the server. Adding it after v1 export files exist in the wild means writing import shims forever.
3. **[MAJOR] No data-access abstraction (repository/ports).** The spec's `worker/` does Drizzle/D1 access inline and `client/` fetches "via the typed RPC client." If the client calls RPC directly, swapping to a local CRDT + sync engine touches every component.

Everything else (op-log shape, LWW grain, the relational tree → CRDT-table mapping, deletes/tombstones) is either already fine or correctly deferred. Details below.

---

## 1. Entity IDs — [BLOCKER] underspecified, implies a corner

**Finding.** §2.1 lists `id` on every entity (User, Routine, Side, Figure, Step, Thread, Comment, JournalEntry, EditOp) but **never says where `id` comes from.** §2.3 says "everything is in D1," and the natural D1/Drizzle default is `integer primary key autoincrement` — a **server-assigned** id. The spec gives no countervailing instruction, so the default reading is server-assigned autoincrement.

**Why this is the load-bearing corner.** Offline creation _requires_ globally-unique, client-generatable IDs. If a partner adds a figure offline, the figure (and its two step charts, and threads anchored to those steps) needs a stable id **before** it ever reaches the server — otherwise you cannot build the FK graph locally, cannot anchor a thread to a not-yet-server-known step, and cannot merge two clients that each created rows. Autoincrement is fundamentally incompatible with this: two offline clients both mint `id=42`. The CRDT substrates in platform.md (TinyBase rows, Yjs maps) are all keyed by client-chosen string ids; there is no autoincrement in a MergeableStore.

**Cost asymmetry.** Fixing now = one sentence ("all entity ids are client-generated ULIDs/UUIDv7, unique across clients; D1 stores them as text PKs"). Fixing later = a migration that rewrites every PK and every FK (`routineId`, `sideId`, `figureId`, `stepId`, `threadId`, anchor `stepId`/`figureId`, `copiedFromRoutineId`, op-log `routineId`) in every client's exported/persisted data, plus a dual-id transition period. This is the single most expensive-later, cheapest-now item in the whole review.

**Note it also helps v1.** Client-generated ids make v1's optimistic update + reconcile (§7.2.3) cleaner — the client already knows the id it created, so the optimistic row and the server row are the same row; no id-reconciliation round-trip. So this is not "pay now for v2"; it pays in v1.

**Recommend (NOW):** Add to §2.1: *"All entity `id`s are **client-generated, globally-unique** sortable identifiers (ULID or UUIDv7), stored as text primary keys in D1. No autoincrement. This makes optimistic creation unambiguous in v1 and is a prerequisite for offline creation in v-next."* Prefer ULID/UUIDv7 (lexicographically sortable → good index locality, and a natural creation-order tiebreak).

---

## 2. The op-log (§5.4 / §2.1 `EditOp`) — bridge or competitor? [MAJOR] shape it now

**Finding.** §2.1 `EditOp` is `{ id, routineId, userId, seq (monotonic per routine), createdAt, kind, forward, inverse, undone }`. §5.4 says the server appends it on every mutation; `seq` is **server-assigned and server-ordered**.

**Is it a bridge to CRDTs or a competitor?** Honestly: **today it is mildly a competitor, but it is the single best seed for the future CRDT op-stream and should be reshaped now at near-zero cost.** Analysis:

- **Server-ordered `seq` does NOT survive offline.** A monotonic per-routine `seq` assigned by the server is exactly the thing that breaks when two clients generate ops offline — they cannot both own `seq=57`. So the `seq`-as-total-order design is online-only by construction. That is _fine_ for v1, but it must not be the only ordering the system knows about, or v2 throws the op-log away and starts over.
- **It could cleanly evolve into the CRDT op stream** — the forward/inverse structure is genuinely valuable (it is essentially an operation-based CRDT entry, and forward/inverse is what gives you undo, which a state-based CRDT like TinyBase MergeableStore does NOT give you for free; see critique-sync.md, history deferred). An op-log with per-op causal metadata is the natural substrate for an **op-based** CRDT future, and is _more_ powerful than the state-based MergeableStore route platform.md recommended, precisely because it preserves intent and inverse.
- **The friction:** `kind` + `forward`/`inverse` are described only by example (`step.setSlot`, `figure.add`, `side.reorder`). For ops to survive offline + merge, each must be **commutative-or-orderable without server arbitration**, which requires per-op identity and a partial order that isn't `seq`.

**Recommend (NOW — cheap, additive to the op record):**
1. **Give every op a client-generated op `id` (ULID) AND keep `seq` as a server-assigned _projection_, not the identity.** v1 reads order from `seq`; v2 will read order from a logical clock. Decoupling them now costs one extra column.
2. **Add a per-actor logical clock to the op: `actorId` + `lamport` (or an HLC `{wall, counter, actorId}`).** In v1 the server fills these trivially (single actor at a time), so it is dead weight that costs nothing; in v2 it is the merge key. critique-sync.md M3/m8 specifically warns that pure wall-clock LWW + skewed mobile clocks = "fast clock wins"; an HLC with `actorId` tiebreak is the standard fix and is the same field you'd add for the op-log. Add it once, use it in both eras.
3. **Keep `forward`/`inverse` payloads as structured, self-describing diffs** (entity type + id + field + before/after), not opaque blobs — so a future merge layer can reason about which ops touch the same cell (LWW grain, §3) without re-parsing `kind` strings.

**What is correctly deferred:** the actual conflict resolution, causal delivery, and the decision of op-based-CRDT-vs-state-CRDT. Just don't foreclose it by making `seq` the only clock.

---

## 3. LWW field grain & the relational tree → CRDT model (§5.4, §2) — [MINOR], mostly already CRDT-ready

**Finding.** v1 does server-side LWW "per field" (§5.4): "if two editors change the same field… the later-arriving write wins… edits to different fields/steps are independent and both persist." This is a deliberate, explicit per-field grain.

**Does it map onto CRDT cells?** **Yes, cleanly.** TinyBase MergeableStore is LWW-_per-cell_ (platform.md, critique-sync.md B1). The spec's "per-field" LWW grain is _the same grain_ as a CRDT cell. This is a genuine door-open win and the spec deserves credit: a Step's `rise`/`foot`/`sway`/`turn`/`action`/`timing` are exactly the per-cell LWW values MergeableStore would hold. The mapping Routine→Side→Figure→Step → (tables of rows keyed by client id) is direct.

**Friction points (all already either chosen-right or correctly deferred):**
- **Ordered lists via `sortKey` fractional index — already chosen (§2.1 Side/Figure/Step), and it IS the CRDT-ready choice.** Confirmed: platform.md §2 and critique-sync.md M1 both name fractional indexing as the list-ordering mechanism under a CRDT. v1 picked it. Good. Two _residual_ cautions to record now even though not built: (a) **concurrent insert-at-same-gap needs a per-actor jitter/tiebreak** (append `actorId` to the key, or break ties by row-id) to avoid two clients minting the identical key — costs nothing to note now; (b) **rebalancing races** (critique-sync.md M1) — pick a generous key space so v1 never rebalances, deferring the hard problem rather than designing into a corner. One spec sentence: *"`sortKey` keys append the creating actor's id as a tiebreak; v1 uses a generous key space and never rebalances."*
- **Move-across-parent (figure side→side).** critique-sync.md M1/Q-NEW-6: under LWW-per-cell, changing `sideId` + `sortKey` non-atomically can orphan or mis-place. **v1 doesn't support cross-parent move at all (§4.2 only reorders within a parent), which is the correct deferral** — but the spec should add one forward-compat note: *"a figure's position is `(parentId, sortKey)`; if cross-parent move is added, model position as a single composite value written atomically."* Cheap to say, expensive to retrofit if `sideId` and `sortKey` calcify as independent cells.
- **Deletes / tombstones.** critique-sync.md M1/M2/Q-NEW-4: a state CRDT resurrects a hard-deleted row if a concurrent edit re-writes its cells. v1 does server-authoritative hard delete, which is fine online. **For v2 this needs tombstones + remove-wins.** This is correctly deferred (no offline store yet), BUT there is a _cheap-now_ hook: v1's delete is already an `EditOp` (`kind` like `figure.delete` with an inverse) — so deletion is already represented as a reversible op, which is exactly the tombstone seed. Recommend the spec note that **delete must remain an op (never a bare row-drop) so it can become a tombstone**, and that undo of a delete already exercises the resurrect path. Low cost, real payoff.

---

## 4. Schema / version migration of persisted data — [MAJOR] add `schemaVersion` NOW

**Finding.** The spec has **no schema-version field anywhere** — not on the routine, not on the export envelope (§8), not on the op-log, not anticipated for the future CRDT store. §8 promises round-trippable JSON export AND import in v1.

**Why this bites in v1 already (not just v2).** The moment v1 ships export/import, **export files exist in the wild** carrying a particular shape. The spec _itself anticipates additive schema changes_: confirmed enum additions are coming (§3 marks many values `[confirm]`/deferred — finer turn magnitudes, broader footwork, the Q-D4 body vocabulary, Latin dances via the `travelling` flag). An import of an old export, or a future CRDT merge of old-shaped persisted cells, is the exact "local-first killer" critique-sync.md M3/Q-NEW-5 names: stale data with old vocabulary merges below the Zod layer and either wins via LWW or fails validation. The spec's §9.5 "malformed op rejected with typed error" assumes a validation chokepoint that a future CRDT merge bypasses — same gap the prior critique flagged.

**Cost asymmetry.** Adding a `schemaVersion: number` to the export envelope and to the routine row now = trivial. Adding it after v1 export files exist = every importer must heuristically sniff the version of unversioned files forever, and the future CRDT has no min-supported-version gate to refuse dangerously-old clients.

**Recommend (NOW):**
1. Add `schemaVersion` to the **export/import envelope** (§8) — non-negotiable, since export ships in v1.
2. Add `schemaVersion` (or reuse it) on the **Routine** so a persisted/cached routine carries its shape version (the planned offline-_read_ cache in §1.3/§8 already persists routines client-side — it needs this too).
3. State the policy: *"importers/mergers run a migration ladder keyed on `schemaVersion`; a future sync engine refuses to merge a client older than a declared minimum version rather than silently LWW-merging stale vocabulary."* (Resolves critique-sync.md Q-NEW-5 at spec-cost, not code-cost.)

---

## 5. Data-access boundary (§7.1 components) — [MAJOR] add a storage seam

**Finding.** §7.1 defines `domain/` (pure, good — already swappable), `worker/` (Hono routes + **Drizzle/D1 access inline**), and `client/` ("data fetching via the typed RPC client … optimistic update + reconcile against server response"). There is **no repository/ports abstraction** named. The risk is that React components and hooks call the Hono RPC client directly.

**Why this is a corner.** The whole v1→v2 thesis is "swap the storage engine from `D1 via RPC` to `local CRDT + sync` without rewriting domain/UI." That is only true if there is a **seam** the UI talks to that hides _where_ data comes from. If components `import { client } from rpc` and call `client.routines.$get()` directly, then every component is coupled to "data comes from the network synchronously-ish," and the CRDT swap (where data comes from a local reactive store that updates out-of-band) is a rewrite of the entire data-fetching layer, optimistic-update logic, and re-render model.

**The good news:** the spec is _already_ doing optimistic update + reconcile (§7.2.3), which means the client already has a local-write-then-confirm mental model — that is exactly the shape a CRDT store wants. The fix is to **name the seam**, not to build new machinery.

**Recommend (NOW — design seam, not implementation):** Add to §7.1: *"The client accesses data only through a thin **`store/` (repository) layer** — a set of typed read (reactive/subscribe) and write (mutation) functions. In v1 this layer wraps the Hono RPC client and an in-memory cache; components never import the RPC client directly. The future offline/CRDT engine replaces the `store/` implementation behind the same interface."* This is the classic ports-and-adapters move, costs only discipline in v1, and is the difference between v2 being a swap vs a rewrite. (Use TanStack Query or a tiny custom store as the v1 implementation — either presents the reactive read + mutate surface the CRDT will later present.)

---

## 6. Honest cheap-now vs correctly-deferred ledger

**Genuinely cheap NOW (do these — they keep the door _actually_ open):**
| Change | Where | Cost now | Cost if deferred |
|---|---|---|---|
| Client-generated ULID/UUIDv7 ids, text PKs, no autoincrement | §2.1 | 1 sentence; helps v1 optimistic create | Rewrite every PK + FK in all persisted/exported data |
| `schemaVersion` on export envelope + routine | §8, §2.1 | 1 field | Version-sniffing every unversioned export forever; no min-version gate |
| Op `id` (ULID) + `actorId` + lamport/HLC on `EditOp`; `seq` becomes a projection | §2.1, §5.4 | extra columns, server-filled trivially in v1 | Throw away op-log; rebuild merge clock; redo HLC for skew |
| Name the `store/` repository seam; ban direct RPC imports in components | §7.1 | discipline only | Rewrite entire data-fetch + optimistic layer at swap |
| `sortKey` actor-id tiebreak + generous-space/no-rebalance note | §2.1 | 1 sentence | Concurrent-insert key collisions; rebalance-vs-insert corruption |
| "Position = `(parentId, sortKey)`, atomic if move added" note | §2.1/§4.2 | 1 sentence | Orphan/mis-place on cross-parent move |
| "Delete stays an op (tombstone seed), never a bare row-drop" note | §2.1/§5.4 | 1 sentence | Resurrection bug; redesign delete semantics |

**Correctly deferred (the spec is right to cut these — they are real v2 work, not door-closers):**
- The actual CRDT engine / TinyBase-vs-Yjs-vs-op-based decision (platform.md Option A/B — the op-log actually opens a _third_, op-based path).
- The sync transport (WebSocket/DO), conflict-resolution semantics, causal delivery.
- Conflict/merge UX, rejected-edit surfacing (critique-sync.md B2/Q-NEW-2) — no offline writes in v1, so genuinely N/A now.
- Tombstone GC, move-across-parent, rebalancing implementation.
- Account-deletion-across-stores (critique-sync.md M5) — relevant whenever data scatters, but not a CRDT-door item per se.

---

## 7. Honest verdict on the "door is open" claims (§1.3, §7, §10)

- **§1.3 "the architecture keeps the door open … but builds none of it now"** — **half-true today, fully-true with the §6 cheap changes.** The relational tree + per-field LWW + `sortKey` already map onto a CRDT; that part of the claim is real and well-earned. The ID, schema-version, and storage-seam gaps are where the claim is currently _aspirational_ — they are the silent corners. They are all one-sentence spec edits.
- **§7 architecture** — the `domain/` purity and optimistic-reconcile model are genuinely CRDT-friendly. The missing piece is the named storage seam (§5 above); without it "swap the engine" is wishful.
- **§10 "offline-first deferred, offline read is next"** — correct and honest as a _scope_ cut. The danger is only in the unstated ID/version/seam decisions, not in the deferral itself.

**Bottom line:** With the seven cheap-now edits in §6, v1→v2-CRDT is a **clean additive path** (new `store/` adapter + sync engine + tombstones, atop unchanged ids, schema-versioned data, and an op-log that becomes the op-stream). **Without the ID and schema-version edits specifically, it is a partial rewrite** of the persistence/ID layer the day real data exists. The op-log is the spec's quiet asset — reshaped per §2 it is a _better_ CRDT seed than the state-based MergeableStore platform.md assumed.
