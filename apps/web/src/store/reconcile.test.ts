// Structural sharing for materialized snapshots — the mechanism behind
// "adding a note must not re-render the whole choreo": unchanged subtrees keep
// their object identity across a full A.toJS rematerialization, so the store's
// referential-stability guards (and React.memo) can bail out precisely.
import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";

describe("reconcile — structural sharing across rematerializations", () => {
  it("returns prev itself when nothing changed (deep-equal snapshots)", () => {
    const prev = { a: [{ id: "x", v: 1 }], b: { c: "s" } };
    const next = { a: [{ id: "x", v: 1 }], b: { c: "s" } };
    expect(reconcile(prev, next)).toBe(prev);
  });

  it("keeps unchanged siblings' identities when one field changes", () => {
    const prev = {
      sections: [
        { id: "s1", placements: [{ id: "p1", figureRef: "f1" }] },
        { id: "s2", placements: [{ id: "p2", figureRef: "f2" }] },
      ],
      annotations: [{ id: "a1", text: "old" }],
    };
    const next = {
      sections: [
        { id: "s1", placements: [{ id: "p1", figureRef: "f1" }] },
        { id: "s2", placements: [{ id: "p2", figureRef: "f2" }] },
      ],
      annotations: [
        { id: "a1", text: "old" },
        { id: "a2", text: "new note" },
      ],
    };
    const merged = reconcile(prev, next);
    expect(merged).not.toBe(prev); // the root changed (annotations grew)
    expect(merged.sections).toBe(prev.sections); // untouched subtree: SAME ref
    expect(merged.annotations).not.toBe(prev.annotations);
    expect(merged.annotations[0]).toBe(prev.annotations[0]); // old note kept
    expect(merged.annotations[1]).toEqual({ id: "a2", text: "new note" });
  });

  it("matches entity arrays by id, so an insert keeps every untouched element", () => {
    const a = { id: "a", v: 1 };
    const b = { id: "b", v: 2 };
    const prev = [a, b];
    const next = [
      { id: "new", v: 0 },
      { id: "a", v: 1 },
      { id: "b", v: 2 },
    ];
    const merged = reconcile(prev, next);
    expect(merged[1]).toBe(a);
    expect(merged[2]).toBe(b);
  });

  it("matches id-less arrays by index", () => {
    const prev = [[1, 2], [3]];
    const next = [
      [1, 2],
      [3, 4],
    ];
    const merged = reconcile(prev, next);
    expect(merged[0]).toBe(prev[0]);
    expect(merged[1]).not.toBe(prev[1]);
  });

  it("preserves null vs undefined and primitive changes", () => {
    const prev = { deletedAt: null, n: 1 };
    expect(reconcile(prev, { deletedAt: null, n: 1 })).toBe(prev);
    const changed = reconcile(prev, { deletedAt: 5, n: 1 });
    expect(changed).toEqual({ deletedAt: 5, n: 1 });
  });

  it("a removed key busts the parent identity", () => {
    const prev = { a: 1, b: 2 };
    const merged = reconcile(prev, { a: 1 });
    expect(merged).not.toBe(prev);
    expect(merged).toEqual({ a: 1 });
  });

  it("never mutates prev — the result is content-identical to next", () => {
    const prev = { list: [{ id: "x", v: 1 }] };
    const next = { list: [{ id: "x", v: 2 }] };
    const merged = reconcile(prev, next);
    expect(prev.list[0]?.v).toBe(1);
    expect(merged).toEqual(next);
  });
});
