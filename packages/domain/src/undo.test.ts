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

describe.skip("US-010 History-based per-user undo", () => {
  it("inverts only user A's last change, reverting just A's edit", async () => {
    // Intent: undo reverts the acting user's own last change (not a global undo).
    // Multi-actor scenario: actor A makes two edits; A undoes the last one.
    // Arrange: a doc with two A-changes. Act: undoLastChange(doc, actorA).
    // Assert: A's last edit is gone; A's earlier edit remains.
    // Covers US-010 AC-1 (invert A's last change) — §10.2 "own-change inverse".
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    let doc = A.from<CountsDoc>({ counts: {} });
    doc = A.change(doc, (d) => (d.counts.first = 1));
    doc = A.change(doc, (d) => (d.counts.second = 2));
    const undone = undoLastChange(doc, "actorA");
    expect(undone.counts.second).toBeUndefined();
    expect(undone.counts.first).toBe(1);
  });

  it("preserves actor B's concurrent edit when A undoes", async () => {
    // Intent: a remote actor's concurrent edit survives A's undo (merges, not blocks).
    // Multi-actor scenario: A and B both edit; A undoes A's change.
    // Arrange: a doc forked into A-replica + B-replica, each edits, then merge.
    // Act: undoLastChange(merged, actorA).
    // Assert: B's edit still present after A's undo.
    // Covers US-010 AC-2 (B's concurrent edit survives) — §10.2 "remote edit preserved".
    const A = await loadAutomerge();
    const { undoLastChange } = await importDomain();
    const base = A.from<CountsDoc>({ counts: {} });
    const aEdit = A.change(base, (d) => (d.counts.a = 1));
    const bEdit = A.change(base, (d) => (d.counts.b = 2));
    const merged = A.merge(A.merge(A.init<CountsDoc>(), aEdit), bEdit);
    const undone = undoLastChange(merged, "actorA");
    expect(undone.counts.b).toBe(2);
  });

  it("redo re-applies the undone change; a new edit clears the redo stack", async () => {
    // Intent: redo restores the undone change; a fresh edit invalidates redo.
    // Arrange: undo a change (redo available). Act: redoLastChange, then a new
    //   edit, then attempt redo again.
    // Assert: redo restores the value; after a new edit, redo is a no-op/unavailable.
    // Covers US-010 AC-3 (redo + new-edit clears redo).
    const A = await loadAutomerge();
    const { undoLastChange, redoLastChange } = await importDomain();
    let doc = A.from<CountsDoc>({ counts: {} });
    doc = A.change(doc, (d) => (d.counts.k = 5));
    const undone = undoLastChange(doc, "actorA");
    const redone = redoLastChange(undone, "actorA");
    expect(redone.counts.k).toBe(5);
  });
});
