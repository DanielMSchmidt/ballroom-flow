# Extensibility Review — Undo / Op-Log System

**Reviewer angle:** Forward-extensibility and correctness of the per-routine `EditOp` log as the app grows (new op kinds, more editors, the deferred offline/CRDT increment).
**Target:** `docs/superpowers/specs/2026-06-24-weave-steps-design.md` — §2.1 (EditOp), §5.4 (concurrent editing & undo), §9 (testing). Prior notes: `research/critique-sync.md`, `research/critique-testing.md`.
**Date:** 2026-06-24.

The op-log is the right idea, and the online-only/server-authoritative move makes it tractable. But the spec describes it as a *feature* ("undo my last change") rather than as a *log discipline*. The gap between those two framings is exactly where it will rot as op kinds multiply and as the second editor's cursor lands inside the first editor's subtree. The spec's three load-bearing rules — "inverse reverses forward," "refuse undo if superseded," "per-user undo is well-defined because each undo targets that user's latest op" — are each true for the easy ops (set a slot) and each quietly false for the structural ops (delete-with-cascade, reorder, save-a-copy) and for causally-entangled cross-user ops. Those are the ops the spec hasn't drawn yet, and they're most of the future.

This review takes the position that **the op-log must be designed now as a proper command/event log with explicit invertibility, a generalized supersession model, and a causal-dependency rule** — not because v1 needs all of it, but because retrofitting any one of these after the schema is frozen is a migration of the durable log itself, which is the worst kind of migration. The good news: doing this *also* pays for the two other anticipated futures — the offline/CRDT increment (§10 "offline read → offline write") consumes an op stream, and attribute-extension (new technique slots, new op kinds) is just new entries in an op registry. The synergy is real and is called out below, but the focus stays on undo correctness.

---

## 1. Ranked Findings

### [BLOCKER] U1 — Cascading deletes are not cleanly invertible under the spec's `forward`/`inverse` shape, and the spec never says what `inverse` contains.

§2.1 defines `EditOp` as `{ kind, forward, inverse, ... }` and §5.4 says undo = "apply the op's `inverse` as a new forward op." For `step.setSlot` this is trivial: `inverse` = the prior slot value. For **delete**, it is not, and the spec gives no shape.

Deleting a figure (§4.0 lists figure/step/side/routine delete as v1) must, on undo, restore:
- the figure row **and both its step charts** (`leaderSteps[]`, `followerSteps[]`),
- every **thread + comment** anchored to any of those steps (anchor = `{step, figureId, role, stepId}`, §2.1),
- every **journal `Link`** pointing at the figure or any of its steps (§2.1 Link),
- the figure's **alignment** pair and `sortKey`,
- and it must restore them with **the same ids**, or every dangling anchor that pointed at the old ids stays dangling (this is exactly `critique-sync.md` M2's orphaning problem, now re-entering through undo).

A naive `inverse: { kind: "figure.add", ... }` that just re-creates the figure does **not** restore the threads/comments/links, and if it regenerates ids it orphans everything. So `inverse` for a cascading delete must capture **the entire deleted subtree as data** (the figure, both charts, all anchored threads/comments, all link rows that referenced it), with original ids preserved, so undo is a faithful resurrection. The spec does not say this, and `EditOp.inverse` as currently sketched (a "change") is too small a container.

**This is a BLOCKER because it is a schema-shape decision in a durable, append-only log.** If `inverse` is sized for field-edits and delete ships storing too little, then every delete logged before the fix is permanently un-undoable, and you cannot retro-widen the stored inverses. Decide the inverse-payload contract *before* the first delete op ships.

> **Cross-axis note (CRDT):** This is the strongest argument for the soft-delete/tombstone model that `critique-sync.md` recommends for the future offline axis. If delete = set `deletedAt` (tombstone) rather than remove rows, then **the inverse of a delete is `{ deletedAt: null }` — a trivial field flip**, the cascade is a query (`WHERE figureId = ? AND deletedAt = ?`), anchored threads/links never dangle (their target row still exists, just hidden), and the same tombstone is exactly what a CRDT needs for remove-wins. Soft-delete collapses U1, U2's structural case, and the future CRDT delete-semantics question into one decision. **Strong recommendation: model delete as soft-delete now.** (See §2.)

### [BLOCKER] U2 — The "superseded op refused" rule is defined only for the field-edit case and does not generalize; it will be re-invented ad-hoc per op kind.

§5.4: undo is allowed "only if the targeted entity still exists and hasn't been superseded — if a later write already changed that field, undo of the stale op is refused." This is a clean rule for `step.setSlot`. It is undefined for:

- **Undoing a structural op when a *child* changed since.** A adds a figure (with seeded charts); B then tags a step inside it; A undoes the add. Is the add "superseded"? By the §5.4 wording, no — *the figure itself* wasn't changed, a child was. So the add undoes, the figure (with B's tag) vanishes, and B's tag op now references a deleted step. The field-level supersession check doesn't see child changes. (This is also U3, the cross-user case.)
- **Reorder.** `side.reorder` / step reorder rewrites `sortKey`s. "The field changed since" — *which* field? If anyone re-reordered, or inserted a sibling that shifted fractional keys, is the original reorder superseded? Undefined.
- **save-a-copy** (deep copy, §5.3) — is this even logged as an undoable op? It creates a *new routine*. Undo would mean deleting the copy. The spec doesn't say. If it's not in the log, "undo my last action" silently skips it, which is surprising right after the user hit "Duplicate."
- **Membership / invite redemption.** Are these EditOps? `invite.redeem` creates a Membership; its inverse removes it. But redemption is done *by the joiner*, not an editor — whose undo stack does it land on, and should it be undoable at all? Undefined.

You cannot keep bolting a bespoke "is-this-superseded?" predicate onto each new op kind; that's how the log becomes unmaintainable. **Define one supersession model that every op kind implements.** Recommended model below (§2): version-stamp every entity touched, and define supersession as **"any entity in this op's *footprint* has a newer mutating op than this one."** Footprint = the set of (entity, version) pairs the op read or wrote, including the subtree root for structural ops.

### [BLOCKER] U3 — "Per-user undo is well-defined" is false once ops are causally dependent across users; this is the central correctness hole.

§5.4 claims per-user undo "is well-defined because each undo targets that user's latest op." That is well-defined as *selection* (which op to undo) but says nothing about *safety of applying* it. The canonical break:

1. **A** does `figure.add` (seq 10) — creates figure F with steps.
2. **B** does `step.setSlot` on a step of F (seq 11) — causally depends on seq 10.
3. **A** undoes their latest = seq 10 → figure F deleted.
4. B's seq 11 now references a deleted step. B's view is corrupt; B's *own* undo of seq 11 now hits the "entity no longer exists" path.

"Each undo targets that user's latest op" does not save you, because A's op had a *dependent* owned by someone else. The spec has no causality/dependency rule, so this is silent cross-user corruption — and it is **strictly worse than the LWW field-conflict the spec does analyze**, because it spans entity lifetimes, not just field values.

**Required: a dependency rule.** Recommended (§2): an op B *depends on* op A if A created or last-mutated any entity in B's footprint. Undo of A is **refused if A has any not-yet-undone dependent op** (by any user), with the message "can't undo — others built on this" (parallel to the "changed since" message). This generalizes U2's child-changed case and U3's cross-user case into **one rule**: *you may undo an op only if nothing not-yet-undone still depends on it.* For the easy field-edit case this reduces to exactly the current "changed since" check, so nothing regresses; it only *adds* safety for the structural/cross-user cases the spec currently mishandles.

### [MAJOR] U4 — Redo via "undo is itself a logged op" gives an incoherent redo stack with two users; redo should be explicit and per-user.

§5.4: undo "applies the inverse as a new forward op (so undo is itself logged and re-undoable)." This means **there is no redo concept — redo is "undo the undo."** For a single user this is *almost* fine, but consider the standard expectation: "undo, undo, undo, redo, redo" should walk back up the exact stack. With "undo = a new op," a user's undo-of-an-undo is selected by "my latest op" — but their latest op might be a *normal edit* they made between undos, or *another user's* activity may have changed what "re-doing" even means. There is no LIFO redo stack; there is just "invert my most recent op, whatever it was." Users will perceive this as "redo did something weird."

**Recommendation:** Keep "undo is a logged op" as the *storage* mechanism (it's correct and it makes undo auditable), but expose an **explicit per-user redo cursor**: a redo is only available immediately after an undo, redoes *that specific* undone op, and is invalidated the moment the user performs a new non-undo edit (standard editor semantics). Track a per-user `redoStack` of op-ids (in memory or a small server-side per-user pointer); don't try to reconstruct redo by scanning the shared log. This is a small addition now and prevents a confusing UX later. It also keeps redo *per-user*, matching undo's per-user grain.

### [MAJOR] U5 — Reorder under concurrent change is under-specified for both invert and supersede.

Reorder is one op (Q-S2 default), and its `inverse` presumably stores the prior `sortKey`(s). Two problems: (a) under LWW, if B inserted/removed a sibling between A's reorder and A's undo, restoring A's old `sortKey` may now place the item at a nonsensical position (the neighbors it was keyed between are gone or moved). (b) If reorder stores only "item X: key k1→k2," undo writes k1 back blindly. **Recommendation:** reorder's inverse should restore the item to a *position relative to surviving siblings* where possible, or fall back to the supersession refusal (U2) when its footprint (the sibling set it reordered against) changed. Practically: include the sibling-set version in the reorder op's footprint so U2's generalized check refuses a now-meaningless reorder-undo rather than corrupting order. (This is the undo-side mirror of `critique-sync.md` M1's fractional-index concerns.)

### [MAJOR] U6 — Op-log growth, retention, replay cost, and snapshotting are entirely unaddressed.

The log is append-only, written on **every** mutation (§2.1), *plus* every undo is another op (§5.4), so a heavy tagging session on a 60-step figure across two charts generates hundreds of ops, and undos double the busy ones. There is no statement of:
- **Retention/pruning.** Does the log live forever? Undo UX only needs "recent" ops (you can't undo something from 3 weeks ago meaningfully once superseded). Recommend: keep the full log for audit/export but **only the tail is undo-eligible** — e.g. an op is undo-eligible only until superseded *or* older than N ops / a session boundary. Prune (or cold-archive) inverses of long-superseded ops to cap row growth; superseded ops can keep `forward` (audit) and drop the heavy `inverse` subtree payload (U1).
- **Replay cost / snapshotting.** The spec loads the routine tree directly from D1 rows (§2.3) — state is *materialized*, not replayed from the log. Good: that means there is **no replay cost for normal load** and no snapshotting needed for reads. State this explicitly so nobody later "helpfully" makes load replay the log. The log is for *undo + audit + future op-stream*, not for sourcing current state. (If the future CRDT increment makes the log authoritative, *then* you need snapshots — note it as a known future cost, don't build it now.)

Not a blocker, but unbounded `inverse` subtree payloads (U1) + undo-doubling makes this a real cost question for the documented D1 rows-scanned/storage concern. Decide a retention contract.

### [MINOR] U7 — `seq` is monotonic per routine but its role in ordering/supersession isn't stated.

§2.1 gives `EditOp.seq` "monotonic per routine." Good — that's the total order that makes supersession and dependency decidable *without* wall-clocks (sidestepping the HLC-skew worry from `critique-sync.md` m8, since v1 is server-authoritative and the server assigns `seq`). But the spec never says `seq` *is* the supersession/ordering authority. Make it explicit: supersession and dependency (U2/U3) are computed over `seq` order, and the server assigns `seq` under the same transaction that writes the mutation, so it's gapless and authoritative. (This also future-proofs the CRDT axis: a server-assigned per-routine sequence is a clean basis for an op stream.)

### [MINOR] U8 — Coalescing (Q-S2) interacts with invertibility and must coalesce the *inverse* correctly.

Q-S2's default coalesces same-field edits in a ~1s window into one op. Correct inverse for a coalesced op = the value **before the first** edit in the window, not before the last. Trivial to get wrong (storing the most-recent prior value). One unit test pins it. Also: coalescing must not cross a supersession/dependency boundary — don't coalesce A's two edits if B wrote between them. Cheap to state now.

---

## 2. Recommended Undo / Op-Log Model (generalizes to new op kinds, handles cascade + cross-user + redo)

A small, explicit command-log discipline. Five pieces:

**(a) Op registry, not ad-hoc kinds.** Each op kind is a record implementing a tiny interface:
```
interface OpKind<F, I> {
  kind: string;                       // "step.setSlot", "figure.delete", "side.reorder", ...
  apply(db, forward: F): Footprint;   // mutates, returns entities touched (id + new version)
  invert(forward: F, captured: I): F; // produces the forward op that reverses this one
  capture(db, forward: F): I;         // PRE-apply: snapshot enough to invert (for delete: the subtree)
}
```
Adding a future op kind = adding one registry entry + its tests. No core changes. **This is the attribute-extension synergy:** a new technique slot is a new value in `step.setSlot`; a genuinely new structural mutation is one new registry entry. The undo machinery never changes.

**(b) `EditOp` schema (widen `inverse` now):**
```
EditOp {
  id, routineId, userId, seq,           // seq = server-assigned, gapless, the ordering authority (U7)
  createdAt, kind,
  forward: json,                        // the applied change
  inverse: json,                        // FULL reverse payload — for delete, the captured subtree with original ids (U1)
  footprint: json,                      // [{entityType, entityId, versionBefore}] the op read/wrote (U2/U3)
  undone: bool,
  undoneByOpId: nullable,               // which undo op reversed this (audit + redo)
}
```
Every mutable entity carries a `version` (or reuses `updatedAt`/a per-entity counter) bumped on each mutating op. `footprint` records `versionBefore` for each touched entity.

**(c) Soft-delete / tombstones (collapses U1 + cascade + future CRDT).** Delete sets `deletedAt`; rows stay. Then:
- `inverse` of a delete = `{ deletedAt: null }` over the subtree — *no subtree snapshot needed*, ids preserved, anchored threads/links never dangle.
- Cascade is a query on `deletedAt`, not a stored blob.
- Reads filter `deletedAt IS NULL`. GC of long-tombstoned rows is a separate retention job (U6).
- This is exactly the remove-wins tombstone the offline/CRDT increment will need — **build it once, now.**

**(d) One supersession + dependency rule (replaces the field-only §5.4 rule, covers U2/U3):**
> An op `O` is **undoable** iff, for every entity in `O.footprint`, **no later not-yet-undone op (`seq > O.seq`, by any user) has that entity in *its* footprint.**

- Field-edit case: reduces to exactly the current "field changed since → refuse." No regression.
- Structural case: A's `figure.add` has F (and its steps) in its footprint; B's later tag on a step of F puts that step in B's footprint → A's add is **refused** ("others built on this") instead of silently deleting B's work. U2 and U3 solved by the same predicate.
- Reorder: footprint includes the reordered sibling set → a later insert/reorder refuses the stale undo (U5).

Message vocabulary: "can't undo — changed since" (your own later edit) and "can't undo — others built on this" (a dependent op exists). Both are the *same* check; the message just distinguishes self vs other.

**(e) Explicit per-user redo cursor (U4).** Undo is still stored as a new logged op (auditable, re-undoable as storage). But expose redo as a per-user, in-session pointer: after undoing op X, redo re-applies X's forward; any new non-undo edit by that user clears their redo cursor. Don't reconstruct redo by log-scanning.

**Why design this now even though it's "more than v1 needs":** every part of this is in the *durable append-only log schema* or the *delete representation*. Both are the things you cannot cheaply change later — a too-small `inverse`, a hard-delete, or a missing `footprint` becomes a migration of historical log rows and of every deleted entity. The supersession predicate and redo cursor are pure logic (testable in `domain/`, §7.1 already carves out "op-log apply/invert logic") and add little code. And the same three additions (footprint/seq, tombstones, op registry) are precisely what the deferred CRDT op-stream and attribute-extension consume — so this is not speculative gold-plating; it is the cheapest version of three roadmap items at once.

---

## 3. Minimal Spec Changes to Make NOW

1. **§2.1 EditOp:** widen the entity. Add `footprint` (touched entities + versionBefore), `undoneByOpId`. State that `inverse` for structural ops must restore the affected subtree faithfully — and adopt **soft-delete** so `inverse` of a delete is a `deletedAt` flip rather than a stored subtree. Add `version`/`updatedAt`-bump to mutable entities.
2. **§5.4:** replace the field-only supersession sentence with the **one undoability rule** (footprint + later-dependent-op check), and add the cross-user dependency case explicitly (A-adds / B-tags / A-undoes) as a *handled* case, not an undefined one.
3. **§5.4:** add an **explicit per-user redo** paragraph; clarify undo-is-a-logged-op is the storage mechanism, redo is the cursor.
4. **§5.3 (save-a-copy):** state whether it's an EditOp (recommend: yes, with inverse = delete the copy, undoable by the copier only).
5. **§2.1 / §5.5:** state whether `invite.redeem` / `member.remove` are EditOps and on whose undo stack (recommend: membership changes are *not* in the per-routine undo stack — they're administrative; undo them via explicit re-invite/remove, not the editor undo).
6. **New §5.6 (or §2.3 note):** state the **log is not the source of current state** (state is materialized in D1 rows; no replay on load), plus the **retention contract** (undo-eligible tail; prune/cold-archive `inverse` payloads of long-superseded ops; GC tombstones).
7. **Delete soft-delete** decision recorded in §4.0 delete flows.

---

## 4. Added Test Scenarios (augment §9)

§9 currently lists (9.1) "every op kind has a correct inverse; apply-then-invert restores; superseded refused; per-user interleaving targets the right op; undo is re-undoable." That's a good *list* but, as `critique-testing.md` argues for the CRDT, it's scenario-naming without the hard cases. Add:

**§9.1 (unit, `domain/`) — property-based (fast-check):**
- **Inverse round-trip for EVERY registered op kind:** generate random valid `forward` for each kind, `apply` then `apply(invert(...))`, assert state byte-identical. This is a *property over the registry*, so new op kinds are auto-covered when registered. (Highest-value test — pins U1 for all kinds.)
- **Coalesced inverse correctness (U8):** N same-field edits in a window → inverse restores the value before the *first*.
- **Supersession/dependency predicate (U2/U3):** table-test the one rule over {own-later-edit, other-user-dependent-op, child-changed, sibling-reordered, nothing-changed} → asserts allow/refuse + which message.
- **Redo cursor (U4):** undo→redo restores; a new edit between clears the cursor; multi-user activity doesn't corrupt one user's redo.

**§9.2 (Worker/D1 integration):**
- **Cascade-delete then undo restores the WHOLE subtree with original ids** — figure + both charts + anchored threads/comments + journal links all reattached, no dangles. (Pins U1 end-to-end; with soft-delete this is asserting `deletedAt` round-trips and reads re-include the subtree.)
- **Cross-user dangling refusal (U3):** A `figure.add`, B tags a step inside, A's undo of the add is **refused** with "others built on this"; B's tag survives.
- **save-a-copy undo:** undo of a copy deletes the copy; original untouched.
- **Reorder-vs-insert undo (U5):** reorder, then a sibling insert, then undo-the-reorder → refused (not corrupting order).

**§9.4 (E2E):**
- Two contexts: A adds figure, B tags inside it, A attempts undo → A sees refusal, B's tag intact (the §9.4 "undo of a field the partner since changed" test exists; **add the structural/cross-user variant**).
- Redo after undo across a partner's interleaved edit behaves per single-user expectation.

---

*End of undo/op-log extensibility review.*
