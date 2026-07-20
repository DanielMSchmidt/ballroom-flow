// attribute-predicate-anchors — matchPredicate: the counts a predicate anchor matches over a
// RESOLVED figure timeline (docs/concepts/annotations.md § Anchors — what a note points at,
// § Test plan). Generalizes the identity match `matchesFigureType` to a predicate over
// notation, matched BY MEANING via normalizeValue read-aliases.
//
// INVARIANT: the match set is sorted, duplicate-free, and ⊆ (attribute counts ∪
// 1..resolveFigureCounts(figure)); the `none` sentinel matches whole beats carrying no
// applicable live attribute; matching runs over resolveFigure OUTPUT (post-variant).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Anchor, Attribute, DanceId, FigureDoc } from "./index";
import { resolveFigure, resolveFigureCounts } from "./index";
import { matchPredicate, PREDICATE_NONE } from "./predicate";

let seq = 0;
const attr = (
  kind: string,
  count: number,
  value: unknown,
  role: Attribute["role"] = null,
): Attribute => ({
  id: `a${seq++}`,
  kind,
  count,
  role,
  value,
  deletedAt: null,
});

const fig = (over: Partial<FigureDoc> & { attributes: Attribute[] }): FigureDoc => ({
  id: "f1",
  scope: "global",
  ownerId: "app",
  figureType: "feather",
  dance: "waltz",
  name: "F",
  source: "library",
  counts: 3,
  baseFigureRef: null,
  schemaVersion: 6,
  deletedAt: null,
  ...over,
});

const predicate = (over: Partial<Extract<Anchor, { type: "attributePredicate" }>>): Anchor => ({
  type: "attributePredicate",
  kind: "sway",
  value: "left",
  scope: "waltz",
  ...over,
});

describe("matchPredicate: value match", () => {
  it("returns exactly the carrying counts, sorted (incl. a sub-beat count)", () => {
    const figure = fig({
      counts: 4,
      attributes: [
        attr("sway", 3, "left"),
        attr("sway", 1, "left"),
        attr("sway", 2.5, "left"),
        attr("sway", 2, "right"),
      ],
    });
    expect(matchPredicate(predicate({ value: "left" }), figure)).toEqual([1, 2.5, 3]);
  });

  it("matches by meaning through registry read-aliases (diag_forward ⇄ diagonal_forward)", () => {
    const figure = fig({ attributes: [attr("direction", 1, "diag_forward")] });
    // persisted legacy value, anchor canonical value
    expect(
      matchPredicate(predicate({ kind: "direction", value: "diagonal_forward" }), figure),
    ).toEqual([1]);
    // persisted canonical value, anchor legacy value (both sides normalized)
    const figure2 = fig({ attributes: [attr("direction", 1, "diagonal_forward")] });
    expect(
      matchPredicate(predicate({ kind: "direction", value: "diag_forward" }), figure2),
    ).toEqual([1]);
  });

  it("a non-predicate anchor and an out-of-scope dance return []", () => {
    const figure = fig({ attributes: [attr("sway", 1, "left")] });
    const point: Anchor = { type: "point", figureRef: "f1", count: 1 };
    expect(matchPredicate(point, figure)).toEqual([]);
    expect(matchPredicate(predicate({ scope: "foxtrot" }), figure)).toEqual([]);
    expect(matchPredicate(predicate({ scope: "all" }), figure)).toEqual([1]);
    // "routine" scope passes here (caller confines by routineRef)
    expect(matchPredicate(predicate({ scope: "routine", routineRef: "r1" }), figure)).toEqual([1]);
  });
});

describe("matchPredicate: the none sentinel", () => {
  it("matches whole beats carrying no applicable live attribute", () => {
    const figure = fig({ counts: 3, attributes: [attr("sway", 1, "left")] });
    expect(matchPredicate(predicate({ value: PREDICATE_NONE }), figure)).toEqual([2, 3]);
  });

  it("role-scoped absence: a leader-only value does not block a follower none", () => {
    const figure = fig({ counts: 3, attributes: [attr("sway", 2, "left", "leader")] });
    // follower none: leader's sway on 2 does not block beat 2
    expect(
      matchPredicate(predicate({ value: PREDICATE_NONE, role: "follower" }), figure),
    ).toContain(2);
    // unroled none: the leader value DOES block beat 2
    expect(matchPredicate(predicate({ value: PREDICATE_NONE }), figure)).toEqual([1, 3]);
  });
});

describe("matchPredicate: role filter", () => {
  it("a leader anchor matches leader + both-sides values, never follower-only", () => {
    const figure = fig({
      counts: 3,
      attributes: [
        attr("sway", 1, "left", "leader"),
        attr("sway", 2, "left", null),
        attr("sway", 3, "left", "follower"),
      ],
    });
    expect(matchPredicate(predicate({ value: "left", role: "leader" }), figure)).toEqual([1, 2]);
  });
});

describe("matchPredicate: unknown values pass through", () => {
  it("an unknown persisted value never matches a known one; anchor pass-through matches itself", () => {
    const figure = fig({ attributes: [attr("sway", 1, "future_sway")] });
    expect(matchPredicate(predicate({ value: "left" }), figure)).toEqual([]);
    expect(matchPredicate(predicate({ value: "future_sway" }), figure)).toEqual([1]);
  });

  it("a non-string persisted value matches nothing", () => {
    const figure = fig({ attributes: [attr("sway", 1, 42)] });
    expect(matchPredicate(predicate({ value: "left" }), figure)).toEqual([]);
  });
});

describe("matchPredicate: tombstones", () => {
  it("a deleted attribute neither matches a value nor blocks none", () => {
    const figure = fig({
      counts: 2,
      attributes: [{ ...attr("sway", 1, "left"), deletedAt: 123 }],
    });
    expect(matchPredicate(predicate({ value: "left" }), figure)).toEqual([]);
    expect(matchPredicate(predicate({ value: PREDICATE_NONE }), figure)).toEqual([1, 2]);
  });
});

describe("matchPredicate: dynamic re-resolution", () => {
  it("retagging the value onto a different count moves the match set", () => {
    const before = fig({ counts: 3, attributes: [attr("sway", 1, "left")] });
    expect(matchPredicate(predicate({ value: "left" }), before)).toEqual([1]);
    const after = fig({
      counts: 3,
      attributes: [{ ...attr("sway", 1, "left"), deletedAt: 5 }, attr("sway", 3, "left")],
    });
    expect(matchPredicate(predicate({ value: "left" }), after)).toEqual([3]);
  });

  it("matches over resolveFigure output — a variant's owned-beat retag, not the base value", () => {
    const base = fig({ counts: 3, attributes: [attr("sway", 1, "left"), attr("sway", 2, "left")] });
    // variant owns beat 1, retagging it to right; beat 2 resolves live from base (left)
    const variant = fig({
      id: "v1",
      scope: "account",
      ownerId: "u1",
      source: "custom",
      baseFigureRef: "f1",
      counts: undefined,
      attributes: [attr("sway", 1, "right")],
    });
    const resolved = resolveFigure(base, variant);
    expect(matchPredicate(predicate({ value: "left" }), resolved)).toEqual([2]);
    expect(matchPredicate(predicate({ value: "right" }), resolved)).toEqual([1]);
  });
});

describe("matchPredicate: property — match set ⊆ resolved counts, sorted, deduped", () => {
  it("holds for arbitrary attribute sets and anchors", () => {
    const arbAttr = fc.record({
      kind: fc.constantFrom("sway", "rise", "footwork"),
      count: fc
        .tuple(fc.integer({ min: 1, max: 8 }), fc.constantFrom(0, 0.5))
        .map(([n, frac]) => n + frac),
      value: fc.constantFrom<string | number>("left", "right", "none_ish", 7),
      role: fc.constantFrom<Attribute["role"]>(null, "leader", "follower"),
    });
    fc.assert(
      fc.property(
        fc.array(arbAttr, { maxLength: 12 }),
        fc.constantFrom("sway", "rise", "footwork"),
        fc.constantFrom("left", "right", PREDICATE_NONE),
        fc.constantFrom<DanceId | "all">("waltz", "all", "foxtrot"),
        (attrs, kind, value, scope) => {
          const attributes = attrs.map((a) => attr(a.kind, a.count, a.value, a.role));
          const figure = fig({ counts: 8, dance: "waltz", attributes });
          const anchor = predicate({ kind, value, scope });
          const result = matchPredicate(anchor, figure);
          // sorted
          expect(result).toEqual([...result].sort((x, y) => x - y));
          // deduped
          expect(new Set(result).size).toBe(result.length);
          // ⊆ (attribute counts ∪ 1..resolveFigureCounts)
          const universe = new Set<number>(attributes.map((a) => a.count));
          for (let b = 1; b <= resolveFigureCounts(figure); b++) universe.add(b);
          for (const c of result) expect(universe.has(c)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });
});
