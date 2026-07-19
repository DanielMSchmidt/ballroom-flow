import { describe, expect, it } from "vitest";
import { importDomain, loadAutomerge } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-010 — History-based per-user undo [M1, system/developer]
// docs/concepts/collaboration.md § Undo, docs/system/architecture.md § Undo, D14,
// Q-UNDO, docs/system/testing.md invariant: "history-based per-user undo
// (own-change inverse; remote edit preserved; redo)". Automerge has no turnkey
// per-user UndoManager — undo = invert the user's own last change from history
// and apply it as a NEW change so it merges with others' concurrent edits.
//
// Product `undo.ts` (M1 §9 1.9) doesn't exist yet; the helper dynamic-imports
// Automerge (not yet a dep). Skipped until M1. The model doc is a counts map
// stand-in; M1 swaps in real figure/routine docs.
// ─────────────────────────────────────────────────────────────────────────

type CountsDoc = {
  counts: Record<string, number>;
};

// Automerge actor ids MUST be hex strings (a non-hex id throws). `undoLastChange`
// filters the change log by the user's Automerge actor id; the app-user → actor
// mapping is the store seam's concern (M2, see task #70). So these tests set
// explicit hex actors for A and B and pass A's actor id to undo/redo.
const ACTOR_A = "a0a0a0a0a0a0";
const ACTOR_B = "b0b0b0b0b0b0";

describe("US-010 History-based per-user undo", () => {
  it("inverts only user A's last change, reverting just A's edit", async () => {
    // Intent: undo reverts the acting user's own last change (not a global undo).
    // Multi-actor scenario: actor A makes two edits; A undoes the last one.
    // Arrange: a doc authored by actor A with two A-changes. Act: undo(doc, A).
    // Assert: A's last edit is gone; A's earlier edit remains.
    // Covers US-010 AC-1 (invert A's last change) — §10.2 "own-change inverse".
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    let doc = A.from<CountsDoc>({ counts: {} }, ACTOR_A);
    doc = A.change(doc, (d) => (d.counts.first = 1));
    doc = A.change(doc, (d) => (d.counts.second = 2));
    const undone = undoLastChange(doc, ACTOR_A);
    expect(undone.counts.second).toBeUndefined();
    expect(undone.counts.first).toBe(1);
  });

  it("preserves actor B's concurrent edit when A undoes", async () => {
    // Intent: a remote actor's concurrent edit survives A's undo (merges, not blocks).
    // Multi-actor scenario: A and B both edit; A undoes A's change.
    // Arrange: a shared base branched into an A-replica + a B-replica (distinct hex
    //   actors via clone), each edits offline, then merge. Act: undo(merged, A).
    // Assert: B's edit still present after A's undo.
    // Covers US-010 AC-2 (B's concurrent edit survives) — §10.2 "remote edit preserved".
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    const base = A.from<CountsDoc>({ counts: {} }, ACTOR_A);
    const aEdit = A.change(A.clone(base, { actor: ACTOR_A }), (d) => (d.counts.a = 1));
    const bEdit = A.change(A.clone(base, { actor: ACTOR_B }), (d) => (d.counts.b = 2));
    const merged = A.merge(A.merge(A.init<CountsDoc>(), A.clone(aEdit)), A.clone(bEdit));
    const undone = undoLastChange(merged, ACTOR_A);
    expect(undone.counts.b).toBe(2);
  });

  it("undo of a same-cell edit supersedes a concurrent write (Q-UNDO 'superseded' case)", async () => {
    // Intent: pin the documented same-cell concurrency behavior (Staff Finding B,
    // tracked #73). When A and B concurrently write the SAME cell and A undoes,
    // A's inverse restores the cell's pre-A state (absent) — which SUPERSEDES B's
    // concurrent value. This is the Q-UNDO "superseded" case (§5.4: CRDT merges,
    // no hard refusal, a soft superseded hint at most — US-038 warns here). It is
    // the accepted v1 behavior, asserted here so it's explicit, not silent.
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    const base = A.from<CountsDoc>({ counts: {} }, ACTOR_A);
    const aEdit = A.change(A.clone(base, { actor: ACTOR_A }), (d) => (d.counts.x = 1));
    const bEdit = A.change(A.clone(base, { actor: ACTOR_B }), (d) => (d.counts.x = 99));
    const merged = A.merge(A.merge(A.init<CountsDoc>(), A.clone(aEdit)), A.clone(bEdit));
    expect(merged.counts.x).toBe(99); // LWW winner before undo
    const undone = undoLastChange(merged, ACTOR_A);
    expect(undone.counts.x).toBeUndefined(); // A's undo supersedes B's concurrent write
  });

  it("redo re-applies the undone change", async () => {
    // Intent: redo restores the undone change (redo = invert the pending undo).
    // Arrange: a doc (actor A) with one change. Act: undo it, then redo.
    // Assert: undo removed the value; redo restores it.
    // Covers US-010 AC-3a (redo re-applies the undone change).
    const A = await loadAutomerge();
    const { undoLastChange, redoLastChange } = await importDomain();
    let doc = A.from<CountsDoc>({ counts: {} }, ACTOR_A);
    doc = A.change(doc, (d) => (d.counts.k = 5));
    const undone = undoLastChange(doc, ACTOR_A);
    expect(undone.counts.k).toBeUndefined();
    const redone = redoLastChange(undone, ACTOR_A);
    expect(redone.counts.k).toBe(5);
  });

  it("a new edit after undo clears the redo: redo is a no-op and does NOT delete the new edit", async () => {
    // Intent: AC-3b "a new edit clears the redo stack" — once the user makes a
    // fresh edit after undoing, redo must NOT resurrect the undone change AND
    // must NOT revert the fresh edit (a naive "invert the last change" redo would
    // destroy the new edit — the bug this test pins).
    // Scenario: edit X (k=5) → undo X → edit Y (m=9) → redo.
    // Assert: Y survives (m===9), X stays undone (k undefined).
    // Covers US-010 AC-3b.
    const A = await loadAutomerge();
    const { undoLastChange, redoLastChange } = await importDomain();
    let doc = A.from<CountsDoc>({ counts: {} }, ACTOR_A);
    doc = A.change(doc, (d) => (d.counts.k = 5)); // edit X
    doc = undoLastChange(doc, ACTOR_A); // undo X → k gone
    doc = A.change(doc, (d) => (d.counts.m = 9)); // fresh edit Y
    const redone = redoLastChange(doc, ACTOR_A);
    expect(redone.counts.m).toBe(9); // Y intact (redo did not delete it)
    expect(redone.counts.k).toBeUndefined(); // X not resurrected
  });

  // ── Extra edge cases (in the spirit of US-010, beyond the listed ACs) ──

  it("is a no-op when the actor has made no changes", async () => {
    // Intent: undo for a user with nothing to undo returns the doc unchanged
    // (e.g. a viewer, or before that user's first edit).
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    let doc = A.from<CountsDoc>({ counts: {} }, ACTOR_A);
    doc = A.change(doc, (d) => (d.counts.x = 1));
    const undone = undoLastChange(doc, ACTOR_B); // B has no changes here
    expect(undone.counts.x).toBe(1); // untouched
  });

  it("undo only reverts A's LAST change, leaving A's earlier ones", async () => {
    // Intent: a single undo reverts exactly the most recent change (per §5.4
    // undo is single-level — "undo my last change"), leaving earlier ones.
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    let doc = A.from<CountsDoc>({ counts: {} }, ACTOR_A);
    doc = A.change(doc, (d) => (d.counts.one = 1));
    doc = A.change(doc, (d) => (d.counts.two = 2));
    doc = A.change(doc, (d) => (d.counts.three = 3));
    const once = undoLastChange(doc, ACTOR_A); // reverts `three`
    expect(once.counts.three).toBeUndefined();
    expect(once.counts.two).toBe(2);
    expect(once.counts.one).toBe(1);
  });

  // ── STRING fields (the counts-map model above only exercised numbers) ──

  it("restores the prior STRING value on undo (not '')", async () => {
    // Regression: Automerge 3 stores string fields as text sequences, so reverting
    // a whole-string change (e.g. a section/routine rename) emits put("") +
    // splice(insert before-value) — NOT a single `put`. The inverse must
    // reconstruct the string; an earlier bug applied only the `put` and left the
    // field "". The numeric counts-map tests above could never catch this.
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    let doc = A.from<{ title: string }>({ title: "Intro" }, ACTOR_A);
    doc = A.change(doc, (d) => (d.title = "Verse"));
    const undone = undoLastChange(doc, ACTOR_A);
    expect(undone.title).toBe("Intro"); // restored, NOT ""
  });

  // ── US-038 AC-3 — soft "superseded by others" hint (advisory; undo proceeds) ──
  //
  // Detection only: `wasSupersededByOthers` reports whether another actor has
  // BUILT ON (causally depends on) my next undo target. It NEVER blocks undo —
  // it drives a soft toast at most (docs/concepts/collaboration.md § Undo: "no hard refusal; a soft
  // 'superseded' hint at most"). "Built on" = transitive dependency in the
  // Automerge change graph, which is the precise causal relation (see undo.ts).

  it("flags superseded when another actor built ON my last change (depends on it)", async () => {
    // Intent: B saw A's change (merged it) THEN edited, so B's change causally
    // depends on A's target — the "others built on this" case the hint warns about.
    const A = await loadAutomerge();
    const { wasSupersededByOthers } = await importDomain();
    let aDoc = A.from<CountsDoc>({ counts: {} }, ACTOR_A);
    aDoc = A.change(aDoc, (d) => (d.counts.a = 1)); // A's last change = the undo target
    // B starts from A's doc (sees A's change), then edits → B's change deps ⊇ target.
    let bDoc = A.merge(A.init<CountsDoc>(), A.clone(aDoc));
    bDoc = A.change(A.clone(bDoc, { actor: ACTOR_B }), (d) => (d.counts.b = 2));
    const merged = A.merge(A.merge(A.init<CountsDoc>(), A.clone(aDoc)), A.clone(bDoc));
    expect(wasSupersededByOthers(merged, ACTOR_A)).toBe(true);
  });

  it("does NOT flag superseded when only I have edited", async () => {
    // Intent: no other actor present → the hint must stay quiet (plain "Undone").
    const A = await loadAutomerge();
    const { wasSupersededByOthers } = await importDomain();
    let doc = A.from<CountsDoc>({ counts: {} }, ACTOR_A);
    doc = A.change(doc, (d) => (d.counts.a = 1));
    doc = A.change(doc, (d) => (d.counts.b = 2));
    expect(wasSupersededByOthers(doc, ACTOR_A)).toBe(false);
  });

  it("does NOT flag superseded for a purely CONCURRENT edit (B did not build on mine)", async () => {
    // Intent: B's edit is concurrent (branched from the same base, never saw A's
    // change), so B did not "build on" A's change — the hint stays quiet even
    // though both edited. (This is distinct from the Q-UNDO same-cell clobber,
    // which is a separate phenomenon and intentionally NOT flagged here.)
    const A = await loadAutomerge();
    const { wasSupersededByOthers } = await importDomain();
    const base = A.from<CountsDoc>({ counts: {} }, ACTOR_A);
    const aEdit = A.change(A.clone(base, { actor: ACTOR_A }), (d) => (d.counts.a = 1));
    const bEdit = A.change(A.clone(base, { actor: ACTOR_B }), (d) => (d.counts.b = 2));
    const merged = A.merge(A.merge(A.init<CountsDoc>(), A.clone(aEdit)), A.clone(bEdit));
    expect(wasSupersededByOthers(merged, ACTOR_A)).toBe(false);
  });

  it("does NOT flag superseded when the actor has nothing to undo", async () => {
    // Intent: no undo target (B never edited) → no hint, mirroring undo's no-op.
    const A = await loadAutomerge();
    const { wasSupersededByOthers } = await importDomain();
    let doc = A.from<CountsDoc>({ counts: {} }, ACTOR_A);
    doc = A.change(doc, (d) => (d.counts.a = 1));
    expect(wasSupersededByOthers(doc, ACTOR_B)).toBe(false);
  });

  it("restores A's string on undo while preserving B's concurrent disjoint string edit", async () => {
    // String-field revert composes with merge: A's rename is reverted to the
    // prior string while B's concurrent edit to a different field survives.
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    type Doc = { title: string; note: string };
    const base = A.from<Doc>({ title: "Intro", note: "" }, ACTOR_A);
    const aEdit = A.change(A.clone(base, { actor: ACTOR_A }), (d) => (d.title = "Verse"));
    const bEdit = A.change(A.clone(base, { actor: ACTOR_B }), (d) => (d.note = "B-note"));
    const merged = A.merge(A.merge(A.init<Doc>(), A.clone(aEdit)), A.clone(bEdit));
    const undone = undoLastChange(merged, ACTOR_A);
    expect(undone.title).toBe("Intro"); // A's string restored (not "")
    expect(undone.note).toBe("B-note"); // B's concurrent edit survives
  });

  // ── docs/system/architecture.md § Undo soundness regressions (2026-07-02 review) ──────────────────
  // The two verified failure modes of the positional-replay implementation:
  // (1) list inverses replayed by index deleted a CONCURRENT peer's element;
  // (2) a second undo press re-inverted the same change destructively.

  type ItemsDoc = { items: { id: string; label: string }[] };

  it("undoing A's list insert removes ONLY A's element under a concurrent B insert (identity, not index)", async () => {
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    const base = A.from<ItemsDoc>({ items: [{ id: "i1", label: "a" }] }, ACTOR_B);
    // A and B each insert at index 0, concurrently.
    const aEdit = A.change(A.clone(base, { actor: ACTOR_A }), (d) =>
      d.items.splice(0, 0, { id: "A-ins", label: "from A" }),
    );
    const bEdit = A.change(A.clone(base, { actor: ACTOR_B }), (d) =>
      d.items.splice(0, 0, { id: "B-ins", label: "from B" }),
    );
    const merged = A.merge(A.merge(A.init<ItemsDoc>(), A.clone(aEdit)), A.clone(bEdit));
    expect(merged.items).toHaveLength(3);
    const undone = undoLastChange(merged, ACTOR_A);
    const ids = undone.items.map((i) => i.id);
    expect(ids).not.toContain("A-ins"); // A's own insert reverted…
    expect(ids).toContain("B-ins"); // …B's concurrent insert SURVIVES
    expect(ids).toContain("i1");
  });

  it("a second undo press never re-inverts the same change (no destructive repeat)", async () => {
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    const base = A.from<ItemsDoc>(
      {
        items: [
          { id: "x", label: "x" },
          { id: "y", label: "y" },
        ],
      },
      ACTOR_B,
    );
    let doc = A.change(A.clone(base, { actor: ACTOR_A }), (d) =>
      d.items.splice(1, 0, { id: "NEW", label: "new" }),
    );
    doc = undoLastChange(doc, ACTOR_A);
    expect(doc.items.map((i) => i.id)).toEqual(["x", "y"]);
    // The old bug: the second press replayed `del @1` again and deleted "y".
    doc = undoLastChange(doc, ACTOR_A);
    expect(doc.items.map((i) => i.id)).toEqual(["x", "y"]); // no-op — nothing of A's left to undo
  });

  it("successive undos walk back through the actor's own changes, each reverted at most once", async () => {
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    const base = A.from<ItemsDoc>({ items: [] }, ACTOR_B);
    let doc = A.change(A.clone(base, { actor: ACTOR_A }), (d) =>
      d.items.push({ id: "i3", label: "3" }),
    );
    doc = A.change(doc, (d) => d.items.push({ id: "i4", label: "4" }));
    doc = undoLastChange(doc, ACTOR_A);
    expect(doc.items.map((i) => i.id)).toEqual(["i3"]); // last change reverted
    doc = undoLastChange(doc, ACTOR_A);
    expect(doc.items.map((i) => i.id)).toEqual([]); // walked back to the previous change
    doc = undoLastChange(doc, ACTOR_A);
    expect(doc.items.map((i) => i.id)).toEqual([]); // nothing left → no-op
  });

  it("redo restores the exact undone list element, and undo can then revert it again", async () => {
    const A = await loadAutomerge();
    const { redoLastChange, undoLastChange } = await importDomain();
    const base = A.from<ItemsDoc>({ items: [{ id: "i1", label: "a" }] }, ACTOR_B);
    let doc = A.change(A.clone(base, { actor: ACTOR_A }), (d) =>
      d.items.splice(1, 0, { id: "i2", label: "b" }),
    );
    doc = undoLastChange(doc, ACTOR_A);
    expect(doc.items.map((i) => i.id)).toEqual(["i1"]);
    doc = redoLastChange(doc, ACTOR_A);
    expect(doc.items.map((i) => i.id)).toEqual(["i1", "i2"]); // element restored with its content
    expect(doc.items[1]?.label).toBe("b");
    doc = undoLastChange(doc, ACTOR_A); // the redo re-armed the target
    expect(doc.items.map((i) => i.id)).toEqual(["i1"]);
  });
});
