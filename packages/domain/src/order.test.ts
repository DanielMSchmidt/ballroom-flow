import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ensureSortKeys,
  keyBetween,
  keyForMove,
  type Ordered,
  sequentialKeys,
  sortByOrder,
} from "./order";

// ─────────────────────────────────────────────────────────────────────────
// #63 — Fractional-index ordering keys (PLAN §5.3).
// keyBetween/sequentialKeys/sortByOrder/keyForMove underpin sortKey-based
// reorder so concurrent same-list reorders converge with no lost edits.
// ─────────────────────────────────────────────────────────────────────────

describe("order — keyBetween", () => {
  it("between(null, null) is a non-empty key that does not end in zero", () => {
    const k = keyBetween(null, null);
    expect(k.length).toBeGreaterThan(0);
    expect(k.endsWith("0")).toBe(false);
  });

  it("produces a key strictly between two keys", () => {
    const a = keyBetween(null, null);
    const c = keyBetween(a, null);
    const b = keyBetween(a, c);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it("before-first yields a key below the first", () => {
    const first = keyBetween(null, null);
    const before = keyBetween(null, first);
    expect(before < first).toBe(true);
  });

  it("after-last yields a key above the last", () => {
    const last = keyBetween(null, null);
    const after = keyBetween(last, null);
    expect(after > last).toBe(true);
  });

  it("throws when the lower bound is not below the upper bound", () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    expect(() => keyBetween(b, a)).toThrow();
    expect(() => keyBetween(a, a)).toThrow();
  });

  it("subdivides repeatedly between the same two bounds, staying strictly ordered", () => {
    // Repeatedly insert between `lo` and the previously-inserted key: each new
    // key must remain strictly between its neighbours (no collision, no inversion).
    const lo = keyBetween(null, null);
    const hi = keyBetween(lo, null);
    let upper = hi;
    const seen = new Set<string>([lo, hi]);
    for (let i = 0; i < 50; i++) {
      const mid = keyBetween(lo, upper);
      expect(lo < mid).toBe(true);
      expect(mid < upper).toBe(true);
      expect(seen.has(mid)).toBe(false); // no collision
      seen.add(mid);
      upper = mid;
    }
  });

  it("never collides on sequential appends (deterministic, ordered)", () => {
    const keys: string[] = [];
    let prev: string | null = null;
    for (let i = 0; i < 200; i++) {
      prev = keyBetween(prev, null);
      keys.push(prev);
    }
    expect(new Set(keys).size).toBe(keys.length); // all unique
    // Strictly ascending, and identical to a plain lexicographic sort.
    expect([...keys].sort()).toEqual(keys);
  });

  it("is deterministic — the same bounds always give the same key", () => {
    expect(keyBetween(null, null)).toBe(keyBetween(null, null));
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    expect(keyBetween(a, b)).toBe(keyBetween(a, b));
  });

  it("property: keyBetween(a,b) lands strictly between for random valid bounds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 60 }), (i, j) => {
        const keys = sequentialKeys(64);
        const lo = keys[Math.min(i, j)];
        const hi = keys[Math.max(i, j)];
        if (lo === undefined || hi === undefined || lo >= hi) return; // need a < b
        const mid = keyBetween(lo, hi);
        expect(lo < mid).toBe(true);
        expect(mid < hi).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe("order — sequentialKeys", () => {
  it("returns n ascending, unique keys", () => {
    const keys = sequentialKeys(10);
    expect(keys).toHaveLength(10);
    expect(new Set(keys).size).toBe(10);
    expect([...keys].sort()).toEqual(keys);
  });

  it("returns [] for 0", () => {
    expect(sequentialKeys(0)).toEqual([]);
  });
});

describe("order — sortByOrder", () => {
  it("sorts by sortKey ascending", () => {
    const [k0, k1, k2] = sequentialKeys(3);
    const items: Ordered[] = [
      { id: "c", sortKey: k2 },
      { id: "a", sortKey: k0 },
      { id: "b", sortKey: k1 },
    ];
    expect(sortByOrder(items).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("tie-breaks equal sortKeys by id", () => {
    const items: Ordered[] = [
      { id: "b", sortKey: "V" },
      { id: "a", sortKey: "V" },
    ];
    expect(sortByOrder(items).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("falls back to array order when any item lacks a sortKey (legacy doc)", () => {
    const items: Ordered[] = [{ id: "x" }, { id: "y", sortKey: "V" }, { id: "z" }];
    expect(sortByOrder(items).map((i) => i.id)).toEqual(["x", "y", "z"]);
  });

  it("does not mutate the input", () => {
    const [k0, k1] = sequentialKeys(2);
    const items: Ordered[] = [
      { id: "b", sortKey: k1 },
      { id: "a", sortKey: k0 },
    ];
    sortByOrder(items);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("order — ensureSortKeys", () => {
  it("backfills ascending keys onto a fully-legacy list, preserving order", () => {
    const items: Ordered[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(ensureSortKeys(items)).toBe(true);
    expect(items.every((i) => typeof i.sortKey === "string")).toBe(true);
    expect(sortByOrder(items).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op on a fully-keyed list", () => {
    const [k0, k1] = sequentialKeys(2);
    const items: Ordered[] = [
      { id: "a", sortKey: k0 },
      { id: "b", sortKey: k1 },
    ];
    expect(ensureSortKeys(items)).toBe(false);
  });

  it("leaves a partially-keyed list untouched", () => {
    const items: Ordered[] = [{ id: "a", sortKey: "V" }, { id: "b" }];
    expect(ensureSortKeys(items)).toBe(false);
    expect(items[1]?.sortKey).toBeUndefined();
  });
});

describe("order — keyForMove", () => {
  const make = (n: number): Ordered[] =>
    sequentialKeys(n).map((k, i) => ({ id: String.fromCharCode(97 + i), sortKey: k }));

  const applyMove = (items: Ordered[], from: number, to: number): string[] => {
    const key = keyForMove(items, from, to);
    const source = items[from];
    if (key == null || source === undefined) return items.map((i) => i.id);
    const moved: Ordered = { ...source, sortKey: key };
    const next = items.map((i) => (i.id === moved.id ? moved : i));
    return sortByOrder(next).map((i) => i.id);
  };

  it("moves an item up one slot", () => {
    expect(applyMove(make(4), 2, 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("moves an item down one slot", () => {
    expect(applyMove(make(4), 1, 2)).toEqual(["a", "c", "b", "d"]);
  });

  it("moves the first item to the end", () => {
    expect(applyMove(make(4), 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("moves the last item to the front", () => {
    expect(applyMove(make(4), 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("returns null for a no-op / out-of-range move", () => {
    const items = make(3);
    expect(keyForMove(items, 1, 1)).toBeNull();
    expect(keyForMove(items, 0, -1)).toBeNull();
    expect(keyForMove(items, 0, 3)).toBeNull();
  });
});
