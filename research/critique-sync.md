# Adversarial Critique — Data Model & Sync Correctness

**Reviewer angle:** local-first / CRDT / distributed-data correctness.
**Target:** `docs/superpowers/specs/2026-06-24-weave-steps-design.md` (+ `research/platform.md`).
**Date:** 2026-06-24.

The spec is unusually careful and self-aware — it *names* the central tension (§5.3) and lists 34 open questions. That honesty is good, but it also means several of the hardest correctness problems are filed under "open question" and treated as deferrable when they are actually **architectural prerequisites**: you cannot build §5.3/§6 correctly without resolving them first. The critique below is harshest exactly where the spec is most confident ("merges are trivial," "rejected on reconnect," "additive later").

---

## 1. Ranked Correctness Risks

### [BLOCKER] B1 — "Reject non-owner structural ops at the DO" is incoherent with a state-merging CRDT
§5.3 / §6 say structural ops from a non-owner are "rejected from non-owners" and "rejected on reconnect (defense in depth)." This treats TinyBase `MergeableStore` as if it were an **op-log / command stream** the DO can authorize op-by-op. It is not. `MergeableStore` sync exchanges **per-cell HLC-stamped state** ("here is my value for table/row/cell X at timestamp T") and merges by last-writer-wins per cell. There is no clean, semantically-typed "structural mutation" object arriving at the DO that an auth gate can inspect and veto; there is a *diff of cell states*. To "reject" a non-owner's structural change the DO must:
  1. Know, per cell, which **zone** it belongs to (structure vs annotation) — requires a static cell→zone map covering every table/cell.
  2. Detect that the incoming cell-state for a structure cell **originated from a non-owner** — but the merge protocol carries an HLC, **not a verified author identity per cell**. TinyBase does not authenticate the *writer* of each cell; it has a node/store id, which is client-asserted, not the Clerk `sub`. So the DO cannot reliably attribute a structural cell change to "the non-owner."
  3. **Reverse** the rejected change by writing a newer-timestamped cell with the prior value and syncing that back — which is itself just another LWW write that races the client.

This is the load-bearing claim of the entire permission model and it does not survive contact with how MergeableStore actually syncs. **Either** structure must NOT live in the same MergeableStore that non-owners sync against (put non-owner-visible structure in a **read-only replica / separate store the partner cannot write**, and have only the owner's client sync into the authoritative structure store), **or** you accept that structure is genuinely multi-writer and drop the "reject" language. The spec's middle position — one shared MergeableStore, per-zone DO-side rejection — is the worst of both: it promises an invariant the substrate can't enforce.

### [BLOCKER] B2 — Rejected/clobbered structural edits cause silent local data loss with no rollback path
Even granting B1 were solvable, §6 says "an offline edit a client shouldn't have made is rejected on reconnect." Consider: a partner is offline, the UI *should* hide structural affordances — but the spec also says tags are "owner-only structure" (§5.3, Q-C1) and tags are the single most-tempting thing a coach edits. Suppose a stale client (old bundle before a permission change; or a race where membership/role changed server-side) makes a structural/tag edit offline, accumulates 50 of them over two weeks, then reconnects. The DO "rejects." What does the partner's client *show*? Their local MergeableStore already merged those edits into their view days ago; rejection means the DO sends back authoritative cell-states that **silently overwrite** the partner's local work. There is no diff, no "your 50 edits were discarded," no undo (history is deferred, Q-S1). This is **silent data loss of user-authored content**, which for a notes/coaching app is a trust-destroying bug. The spec has no reconciliation-back-to-offender story at all — it assumes rejection is clean. It is not.

### [BLOCKER] B3 — DO ⇄ D1 dual-write has no consistency mechanism; the index will drift
§2.1, §6, §7.2: live title/structure lives in the DO; a denormalized index row (title, dance, updatedAt, **bar count**) lives in D1 for the list screen. The flow (§7.2.4) routes *some* mutations through the Worker to update D1, but **title and structure are edited inside the DO via CRDT sync, not via a Worker RPC**. So when the owner renames a routine offline and it merges into the DO, **who updates the D1 index row?** Options the spec leaves unspecified:
  - If the rename is a CRDT cell sync straight to the DO, the Worker never sees it → D1 index goes stale (list shows old title forever).
  - If the DO calls back into D1 on every merged change, that is a cross-store write with **no transaction** spanning DO-SQLite and D1; a failure after the DO commit but before the D1 write leaves them divergent with no repair job specified.
  - **Bar count** in the index is *derived from steps* that live only in the DO and change on every step edit — keeping a D1-side bar count fresh means the DO must recompute and push it to D1 on every structural merge. That is a write amplification + consistency problem the spec never addresses, and it directly hits the documented D1 "rows scanned" cost concern.

There is no reconciliation/repair job, no "index is eventually-consistent and may be stale" statement, no ownership of the write. This is a classic dual-write inconsistency and it is currently undefined.

### [MAJOR] M1 — Fractional indexing under a CRDT: interleaving and key exhaustion are under-specified, and cross-parent move is unmodeled
§6 and §9.1 lean on a fractional-index `sortKey` cell for "CRDT-safe reorder." Real problems the spec waves past:
  - **Concurrent insert at the same position → interleaving.** Two offline clients each insert a figure "between A and B." Fractional indexing (e.g. `fractional-indexing` / Figma-style) generates a key strictly between A and B for each — but with **identical** base keys and no jitter, two clients can generate the **same** new key, and LWW-per-cell then makes one figure's sortKey silently overwrite the other's, collapsing two figures onto one ordering slot (stable tiebreak by row-id saves *ordering* but two items now sort adjacently with one having a duplicated key — fine) — OR worse, if they pick different keys, you get deterministic order but **interleaving** that neither user intended (classic list-CRDT interleaving anomaly). The spec's test (§9.4 "deterministic converged order, no duplicates/drops") asserts the happy property but doesn't grapple with *semantic* interleaving (A1,A2 from client 1 and B1,B2 from client 2 ending A1,B1,A2,B2).
  - **Key exhaustion / rebalancing.** Repeated "insert at same gap" (§9.1 says keys "stay distinct") grows key length unboundedly; eventually you rebalance. **Rebalancing rewrites many sortKey cells at once** — under a CRDT with a concurrent offline editor, a rebalance on client A racing any insert on client B is a recipe for total order corruption. The spec has no rebalancing strategy and no test for "rebalance vs concurrent insert."
  - **Move-across-parent (figure from one side to another).** This requires changing **both** `sideId` and `sortKey` atomically. Under LWW-per-cell with no multi-cell atomicity, a concurrent edit can land the figure with a **new `sideId` but stale `sortKey`** (or vice-versa), placing it at a nonsensical position or, if the old side is concurrently deleted, **orphaning** it. The spec lists reorder *within* a parent (§4.2) but the move-across-parent case (explicitly asked about) is not in the model at all.
  - **Delete-vs-edit race.** Owner deletes a figure on device 1 while editing a step inside it on device 2 (or a partner comments on a step inside it). MergeableStore has no native tombstone/GC semantics specified here — does "delete" mean removing the row (which a concurrent edit will *resurrect* by re-writing its cells, the classic add-wins/remove-wins problem)? The spec never states delete semantics (tombstone vs hard-delete, add-wins vs remove-wins). This determines whether deleted figures zombie back, and whether comments/journal links dangle (see M2).

### [MAJOR] M2 — Referential integrity of the polymorphic Link and threads across delete and fork is unguarded
Threads anchor to `{type:"step", stepId}` (§2.1) and Links anchor to a step (§2.1, §4.9). Steps live in the DO; comments and journal entries also live in the DO. Nothing in the model guarantees the anchor target still exists:
  - **Delete a step that has a thread / a journal Link.** The thread/Link now points at a non-existent stepId. The spec specifies delete flows (§4.0) but never says what happens to anchored content. Orphaned threads/links with no cleanup or "this step was deleted" UI is a correctness + UX bug.
  - **Fork orphaning.** §5.4: fork deep-copies structure + tags with **regenerated ids**, but does **not** copy comments/journal. Good — but journal entries are restricted to a single routine (§2.1) and live in the origin DO; a journal Link points at the **origin's** stepId. After the owner heavily edits the origin (deletes the linked step), the Link dangles **in the origin itself** — fork is a red herring; the real orphaning is delete-in-place. And if a user forks specifically to "edit their copy," any journal note they wrote referencing a step is **left behind in the origin**, pointing at a step whose id no longer exists in their working copy. The spec's "comments belong to the original conversation" framing hides that the *journal*, which IS per-user and which the forker presumably wants to carry, gets stranded. **Q-C2 only asks about comments; it misses journal-entry stranding on fork, which is sharper.**
  - **Polymorphic Link forward-compat.** The Link is modeled `{type:"step"|"figure"|"attribute", scope,…}` but only step/routine implemented. The deferred figure/attribute anchors are *queries* (all steps with attribute X), which under a CRDT/DO are **cross-row reactive queries** — "additive later" undersells that these need an indexing/query layer the DO sync model doesn't provide for free.

### [MAJOR] M3 — Offline reconcile + schema migration of persisted CRDT state is unaddressed and is a known hard problem
The spec assumes a client can be offline "for a long time" (§6) and reconcile. But MergeableStore persists **HLC-stamped cell state** to IndexedDB. If a schema migration ships meanwhile (e.g. tags move from owner-only to shared per Q-C1; or a 6th technique slot is added per §3.8; or `role` is added to Step per Q-D1 — all explicitly anticipated as "additive"), the offline client returns with **old-shaped CRDT state carrying old timestamps**. Merging old-shaped cells into a migrated store is not "additive" in CRDT terms:
  - LWW means a stale offline cell with a *later wall-clock-ish HLC* can win over a migrated value.
  - Adding a column is fine; **changing the meaning or vocabulary of a cell** (e.g. CBP→CBM rename in §3.2, Q-D3) means old clients write a now-invalid enum value that merges in and fails Zod validation server-side — but CRDT merge happens *below* the Zod layer. The spec's §9.5 "malformed op rejected with typed error" again assumes an op-validation chokepoint that MergeableStore sync bypasses.
  - There is **no schema-version field on the synced payload**, no migration-on-merge strategy, no "refuse to sync a client older than version N" gate. For a local-first app this is one of the top-three real-world failure modes and it is entirely absent.

### [MAJOR] M4 — TinyBase MergeableStore maturity vs the exact patterns relied upon
platform.md itself flags this (Option A risk: "TinyBase synchronizer maturity for our exact merge edge cases"). Sharpening it: the spec relies on MergeableStore for (a) ordered-list reordering via sortKey, (b) per-cell LWW that is "single-writer in practice," (c) DO-side authorization woven into sync, (d) long-offline reconcile, (e) schema evolution. MergeableStore is a **value/row CRDT with LWW-per-cell and HLC** — it has **no list-CRDT, no move operation, no tombstone policy knob, no per-cell author identity, no causal-delivery guarantee across very long partitions** beyond HLC ordering. Several spec claims (B1, M1 move/delete, M3) are asking MergeableStore to do things it structurally does not do. The mitigation ("two-client Playwright tests") tests the happy path of two short-offline clients; it will **not** exercise rebalancing races, long-partition migration, or move-across-parent. The maturity risk is not "might have bugs" — it is "the chosen primitive lacks the operations the design assumes."

### [MAJOR] M5 — Account deletion / GDPR erasure across DO + D1 + R2 is unspecified and structurally hard
§8 covers *export* (good) but **not deletion**. Constraint-relevant gaps:
  - A user's authored content (comments, journal entries) is **scattered across every routine DO they ever participated in**, including routines **owned by other people**. Deleting the user's D1 row does not touch DO-SQLite content. There is no enumeration of "which DOs hold this user's data" (the membership table helps for routines they're a member of, but a *removed* member, Q-C5 "remain attributed," leaves data in DOs with no membership edge pointing to it).
  - Their `identityColor`/displayName is denormalized into comment attribution inside DOs; erasing the D1 profile leaves dangling authorId references in CRDT cells.
  - Media in R2 keyed by entries inside DOs — deleting requires walking DO → entry → R2 key.
  - **Point-in-time recovery** (platform.md) and CRDT history mean "deleted" data may be restorable, which is in tension with hard-erasure obligations.
  This is a real ownership/compliance gap, not just a feature cut. At minimum the spec must state a data-deletion model even if v1 implements only account-export.

### [MINOR] m6 — "Bar count" derivation duplicated across DO and D1 invites divergence
Derived `bars` is computed client-side (§2.1) AND stored in the D1 index (§2.3). Two derivations of the same quantity from different sources will drift (B3). Either compute on read from the DO, or treat the D1 value as explicitly-stale display-only and label it as such.

### [MINOR] m7 — Identity color uniqueness is the attribution key but collisions are only "warned"
Q-A2 recommends "warn on collision." But color is the *primary visual attribution* of who wrote a comment (§5.1.3). If two members share a color (warned but allowed), attribution is ambiguous and color stops being a reliable signal — and §8 accessibility says color isn't the only signal (initials too), which is good, but then color uniqueness matters less and the "warn" friction is questionable. Decide: color is decorative (allow collisions freely) OR load-bearing for attribution (enforce uniqueness per routine). The spec wants both.

### [MINOR] m8 — HLC clock skew across offline mobile devices
LWW-per-cell ordering depends on HLC, which incorporates wall-clock. Two mostly-offline phones with skewed clocks editing tags: the device with the **fast clock wins** regardless of who edited last in real time. "Single-writer in practice" masks this for structure, but for the genuinely-multi-writer annotation zone (tags-if-shared per Q-C1, and comments edited/deleted) skew can produce "my newer edit lost." Not catastrophic for append-mostly comments; worth a note.

---

## 2. Spec Decisions I Would Change

1. **Stop describing structure auth as "reject ops at the DO." Re-architect the store split (fixes B1/B2).** Pick one of:
   - **(Preferred) Two physical stores, not two logical zones in one store.** An authoritative **structure store** that *only the owner's client* opens read-write and syncs into; partners/coaches get structure as a **read-only snapshot** (server-pushed, never merged from their client). A separate **annotation MergeableStore** (comments, journal, and — if Q-C1 says shared — tags) that all members read-write. Now "non-owner can't edit structure" is enforced by **never giving them a writable structure store**, not by post-hoc rejection. No silent rollback, because their structure store was never writable.
   - Or **(simpler product)** drop "duplicate to edit," make structure genuinely co-edited multi-writer (the couple co-authors — Q-C4 hints they may want this), and use the CRDT for what it's actually good at. The "fork" becomes an explicit *branch*, not the only edit path.
   The current one-store-two-zones-with-rejection model should be removed; it's the spec's weakest load-bearing claim.

2. **Define delete semantics explicitly (fixes part of M1/M2):** choose **tombstone + remove-wins** for figures/steps, with tombstones propagated as cells (so a concurrent edit cannot resurrect a deleted row), and a GC policy. Specify cascade: deleting a step **soft-orphans** its thread/links, which render as "anchored to a deleted step" rather than vanishing.

3. **Make the D1 index explicitly an eventually-consistent projection with a single writer and a repair path (fixes B3):** route *all* index-affecting mutations (title rename, anything feeding bar count) through the Worker RPC, OR have the DO be the sole D1-index writer via a `ctx.blockConcurrencyWhile`-guarded outbound write with a **reconciliation cron** that rebuilds index rows from DO state. State plainly that the list screen may show a stale title/bar-count for up to N seconds. Don't store derived bar count in two places (m6).

4. **Add a schema-version field to the synced payload and a migration-on-load + min-version gate (fixes M3)** before writing any sync code. Decide migration-on-merge policy for vocabulary changes (CBP→CBM) — old clients must be **blocked from syncing**, not silently merged.

5. **Carry the forker's own journal entries into a fork (re-decide Q-C2 for journal, not just comments)** OR explicitly surface "your notes referencing the original remain in the original" — don't strand per-user authored notes (M2).

6. **Add a data-deletion model to §8** alongside export: enumerate DO-resident user data, define erasure across DO+D1+R2, and reconcile with PITR/CRDT-history retention (M5).

7. **Resolve Q-C1 (tags zone) BEFORE building, not after** — it determines the store split (decision 1) and is therefore a structural prerequisite, not a deferrable open question.

---

## 3. New / Sharper Open Questions the Spec Misses

- **Q-NEW-1 (blocking): Does TinyBase MergeableStore expose verified per-cell author identity, and can the DO veto inbound cell-states by zone before merge?** *Why:* the entire §5.3 permission model assumes yes; B1 argues no. *Options:* (a) confirm via a spike that MergeableStore carries authenticated author per cell and supports pre-merge rejection [if false, §5.3 is dead]; (b) two-physical-store split (decision 1); (c) drop per-zone auth, gate at connection only (a member either can write the whole store or can't).

- **Q-NEW-2 (blocking): When a client's offline edits are rejected/overwritten on sync, what does that client see?** *Why:* B2 — currently undefined; the difference between "silent overwrite" and "your N changes couldn't be saved" is the difference between a trustworthy and an untrustworthy app. *Options:* (a) impossible-by-construction via store split [preferred]; (b) keep a local "rejected ops" journal and surface it; (c) accept silent loss and document it (not acceptable for a notes app).

- **Q-NEW-3 (blocking): Who writes the D1 index when title/bar-count change inside the DO, and what is the staleness/repair contract?** *Why:* B3 dual-write. *Options:* (a) Worker-RPC for all index-affecting edits; (b) DO is sole index writer + reconciliation cron; (c) drop persisted bar count, derive on read.

- **Q-NEW-4 (blocking): What is the delete semantics — tombstone vs hard-delete, add-wins vs remove-wins — and the cascade to anchored threads/links?** *Why:* M1/M2; determines zombie-resurrection and orphaning. *Options:* tombstone+remove-wins+soft-orphan [preferred] vs hard-delete (resurrection risk).

- **Q-NEW-5 (blocking): Schema/vocabulary migration of persisted offline CRDT state — version field, min-supported-version gate, migration-on-merge?** *Why:* M3; "additive" is false for vocabulary changes and stale-HLC wins. *Options:* version gate + block old clients [preferred]; per-cell migration map; accept drift (not acceptable).

- **Q-NEW-6 (major): Move-figure-across-side as a first-class operation — how is the (sideId, sortKey) pair updated atomically under LWW-per-cell?** *Why:* M1; not in the model. *Options:* model "position" as a single composite cell (parentId+key) written atomically; or forbid cross-parent move in v1 and say so.

- **Q-NEW-7 (major): sortKey rebalancing strategy and its interaction with concurrent offline inserts.** *Why:* M1 key exhaustion; a rebalance racing an insert corrupts order. *Options:* generous key space + never rebalance in v1; rebalance only owner-online-exclusive; switch to a true list-CRDT (Yjs array) for ordering — which is platform.md's Option B and may be the real answer.

- **Q-NEW-8 (major): Account deletion / GDPR erasure across DO + D1 + R2, reconciled with PITR and CRDT history.** *Why:* M5; durable user-data ownership is a stated value but only export is covered. *Options:* full-erasure walker over membership+DO+R2; crypto-shred (delete key, leave ciphertext); v1 = export-only with documented limitation.

- **Q-NEW-9 (minor): Is identity color decorative or load-bearing for attribution?** *Why:* m7; the spec wants both. Decide enforce-unique-per-routine vs allow-collision.

- **Q-NEW-10 (minor): HLC clock-skew tolerance for the multi-writer annotation zone.** *Why:* m8; skewed mobile clocks make "fast clock wins" not "last edit wins." *Options:* document as acceptable for append-mostly comments; for shared tags consider per-cell merge that's not pure wall-clock LWW.
