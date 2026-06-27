import { describe, expect, it } from "vitest";
import { isOnEighthGrid } from "./timing";
import { parseWdsfTiming } from "./wdsf-timing";

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
