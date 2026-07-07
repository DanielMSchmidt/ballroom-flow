// US-004 / US-028 — bars-driven figure timing grid (PLAN §2.5, §4.4).
import { describe, expect, it } from "vitest";
import type { Attribute } from "./doc-types";
import {
  defaultFigureBars,
  figureCountSlots,
  figureGridSlots,
  resolveFigureBars,
  resolveFigureCounts,
} from "./figure-grid";

const step = (count: number, kind = "footwork"): Attribute => ({
  id: `${kind}-${count}`,
  kind,
  count,
  value: "ball",
  role: null,
  deletedAt: null,
});

describe("defaultFigureBars — ⌈whole-beat steps ÷ beatsPerBar⌉", () => {
  it("is 1 for an empty figure (never zero)", () => {
    expect(defaultFigureBars([], "waltz")).toBe(1);
    expect(defaultFigureBars([], "foxtrot")).toBe(1);
  });

  it("divides distinct whole-beat steps by the dance's beats-per-bar (Waltz = 3)", () => {
    // 6 whole-beat steps in Waltz → 6 / 3 = 2 bars.
    const attrs = [1, 2, 3, 4, 5, 6].map((c) => step(c));
    expect(defaultFigureBars(attrs, "waltz")).toBe(2);
    // 4 whole-beat steps in Foxtrot → 4 / 4 = 1 bar.
    expect(
      defaultFigureBars(
        [1, 2, 3, 4].map((c) => step(c)),
        "foxtrot",
      ),
    ).toBe(1);
  });

  it("rounds partial bars UP and ignores sub-beats + tombstones", () => {
    // 4 whole beats in Waltz → ⌈4/3⌉ = 2 bars; a sub-beat + a tombstone don't count.
    const attrs = [step(1), step(2), step(3), step(4), step(2.5), { ...step(5), deletedAt: 1 }];
    expect(defaultFigureBars(attrs, "waltz")).toBe(2);
  });
});

describe("resolveFigureBars — explicit bars wins, else the default", () => {
  it("uses an explicit positive bars field", () => {
    expect(resolveFigureBars({ bars: 4, attributes: [step(1)], dance: "waltz" })).toBe(4);
  });

  it("falls back to the whole-beat default when bars is absent or invalid", () => {
    const attributes = [1, 2, 3].map((c) => step(c));
    expect(resolveFigureBars({ attributes, dance: "waltz" })).toBe(1);
    expect(resolveFigureBars({ bars: 0, attributes, dance: "waltz" })).toBe(1);
  });
});

describe("figureGridSlots — every timing a bar count allows", () => {
  it("emits each beat then its e/&/a sub-beats, grouped by bar (Waltz = 3/bar)", () => {
    const slots = figureGridSlots(1, "waltz");
    // 3 beats × (1 whole + 3 sub) = 12 slots for one Waltz bar.
    expect(slots).toHaveLength(12);
    expect(slots.map((s) => s.label)).toEqual([
      "1",
      "1e",
      "1&",
      "1a",
      "2",
      "2e",
      "2&",
      "2a",
      "3",
      "3e",
      "3&",
      "3a",
    ]);
    // Whole beats are solid; the sub-beats are dimmed.
    expect(slots.filter((s) => s.whole).map((s) => s.count)).toEqual([1, 2, 3]);
    expect(slots.every((s) => s.bar === 1)).toBe(true);
  });

  it("numbers beats continuously across bars (bar 2 of a Waltz starts at count 4)", () => {
    const slots = figureGridSlots(2, "waltz");
    const bar2 = slots.filter((s) => s.bar === 2 && s.whole);
    expect(bar2.map((s) => s.count)).toEqual([4, 5, 6]);
  });

  it("uses 4 beats per bar for a 4/4 dance (Foxtrot)", () => {
    const slots = figureGridSlots(1, "foxtrot").filter((s) => s.whole);
    expect(slots.map((s) => s.count)).toEqual([1, 2, 3, 4]);
  });

  it("clamps a non-positive bar count to one bar", () => {
    expect(figureGridSlots(0, "waltz").filter((s) => s.whole)).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Builder v3 ① — counts-based length: `counts` is the authored figure length
// (beats); bars are DERIVED (⌈counts / beatsPerBar⌉) for every bar display.
// ─────────────────────────────────────────────────────────────────────────
describe("counts-based figure length (Builder v3 ①)", () => {
  it("resolveFigureCounts prefers authored counts, then legacy bars × bpb, then the step default", () => {
    expect(resolveFigureCounts({ counts: 5, attributes: [], dance: "waltz" })).toBe(5);
    expect(resolveFigureCounts({ bars: 2, attributes: [], dance: "waltz" })).toBe(6);
    expect(resolveFigureCounts({ attributes: [step(1), step(2)], dance: "waltz" })).toBe(2);
    expect(resolveFigureCounts({ attributes: [], dance: "waltz" })).toBe(1);
  });

  it("resolveFigureBars derives ⌈counts / beatsPerBar⌉ (a 4-count Waltz figure spans 2 bars)", () => {
    expect(resolveFigureBars({ counts: 4, attributes: [], dance: "waltz" })).toBe(2);
    expect(resolveFigureBars({ counts: 3, attributes: [], dance: "waltz" })).toBe(1);
    // Legacy docs keep their exact bar count (bars 2 → counts 6 → bars 2).
    expect(resolveFigureBars({ bars: 2, attributes: [], dance: "waltz" })).toBe(2);
  });

  it("figureCountSlots generates one whole + e/&/a rows per count, grouped into bars", () => {
    const slots = figureCountSlots(4, "waltz");
    // 4 counts × (1 whole + 3 sub-beats) rows.
    expect(slots).toHaveLength(16);
    expect(slots[0]).toMatchObject({ count: 1, bar: 1, whole: true });
    // Count 4 starts bar 2 in 3/4.
    const four = slots.find((s) => s.count === 4);
    expect(four).toMatchObject({ bar: 2, whole: true });
    const fourAnd = slots.find((s) => s.count === 4.5);
    expect(fourAnd).toMatchObject({ bar: 2, whole: false, label: "4&" });
  });
});
