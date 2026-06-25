import { describe, expect, it } from "vitest";
import { importDomain, loadAutomerge } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-010 — History-based per-user undo [M1, system/developer]
// PLAN §5.4, D14, Q-UNDO, §10.2 invariant: "history-based per-user undo
// (own-change inverse; remote edit preserved; redo)". Automerge has no turnkey
// per-user UndoManager — undo = invert the user's own last change from history
// and apply it as a NEW change so it merges with others' concurrent edits.
//
// Product `undo.ts` (M1 §9 1.9) doesn't exist yet; the helper dynamic-imports
// Automerge (not yet a dep). Skipped until M1. The model doc is a counts map
// stand-in; M1 swaps in real figure/routine docs.
// ─────────────────────────────────────────────────────────────────────────

interface CountsDoc {
  counts: Record<string, number>;
}

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
});
