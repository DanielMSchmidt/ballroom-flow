import { describe, expect, it } from "vitest";
import { parseAttributeWrite } from "./schemas";
import { isOnEighthGrid } from "./timing";
import { buildWdsfAttributes, parseWdsfTiming } from "./wdsf-timing";

describe("parseWdsfTiming", () => {
  it("numbers across two waltz bars accumulate the beat cursor", () => {
    expect(parseWdsfTiming("123 123")).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("an & splits the preceding symbol into half-beats", () => {
    expect(parseWdsfTiming("1&23")).toEqual([1, 1.5, 2, 3]);
    expect(parseWdsfTiming("12&3")).toEqual([1, 2, 2.5, 3]);
  });

  it("S=2 / Q=1 beats accumulate, spaces are cosmetic", () => {
    expect(parseWdsfTiming("SQQ QQQQ")).toEqual([1, 3, 4, 5, 6, 7, 8]);
    expect(parseWdsfTiming("Q&Q")).toEqual([1, 1.5, 2]);
  });

  it("strips a (… Lady) follower variant, parsing the base timing", () => {
    expect(parseWdsfTiming("123 (12&3 Lady)")).toEqual([1, 2, 3]);
  });

  it("keeps other parenthetical optional steps", () => {
    expect(parseWdsfTiming("S(QQ)")).toEqual([1, 3, 4]);
  });

  it("clamps a leading & (syncopated pickup) to beat 1", () => {
    expect(parseWdsfTiming("&S")).toEqual([1, 1.5]);
  });

  it("every count is >= 1 and on the 1/8 grid for all real timings", () => {
    const all = ["123", "123 123", "1&23 123", "SQ&Q SQQ QQQQ", "QQ& QQS", "SQQ QQ Q&Q"];
    for (const t of all) {
      const cs = parseWdsfTiming(t);
      expect(cs.length).toBeGreaterThan(0);
      for (const c of cs) {
        expect(c).toBeGreaterThanOrEqual(1);
        expect(isOnEighthGrid(c)).toBe(true);
      }
    }
  });
});

describe("buildWdsfAttributes", () => {
  const natural = buildWdsfAttributes({
    figureType: "natural-turn",
    dance: "waltz",
    timing: "123 123",
    start: "RF fwd (Closed Position)",
    finish: "LF closes to RF",
  });

  it("emits one step attribute per parsed count with deterministic ids", () => {
    expect(natural).toHaveLength(6);
    expect(natural.map((a) => a.id)).toEqual([
      "wdsf-natural-turn-waltz-s1",
      "wdsf-natural-turn-waltz-s2",
      "wdsf-natural-turn-waltz-s3",
      "wdsf-natural-turn-waltz-s4",
      "wdsf-natural-turn-waltz-s5",
      "wdsf-natural-turn-waltz-s6",
    ]);
    expect(natural.every((a) => a.kind === "step")).toBe(true);
    expect(natural.map((a) => a.count)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("puts start on step 1, finish on the last step, blanks between", () => {
    expect(natural[0]?.value).toBe("RF fwd (Closed Position)");
    expect(natural[5]?.value).toBe("LF closes to RF");
    expect(natural.slice(1, 5).every((a) => a.value === "")).toBe(true);
  });

  it("produces only attributes the strict write schema accepts", () => {
    for (const a of natural) {
      expect(() => parseAttributeWrite(a, { dance: "waltz" })).not.toThrow();
    }
  });

  it("a single-step figure carries both start and finish on that step", () => {
    const one = buildWdsfAttributes({
      figureType: "x",
      dance: "tango",
      timing: "S",
      start: "LF fwd",
      finish: "weight fwd",
    });
    expect(one).toHaveLength(1);
    expect(one[0]?.value).toBe("LF fwd"); // start wins the lone step
  });
});
