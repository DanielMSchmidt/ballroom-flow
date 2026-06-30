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

describe("buildWdsfAttributes — un-charted scaffold (no authored content)", () => {
  // `hesitation-change` has no figure-steps.ts entry, so the scaffold path runs.
  const scaffold = buildWdsfAttributes({
    figureType: "hesitation-change",
    dance: "waltz",
    timing: "123 123",
    start: "RF fwd (Closed Position)",
    finish: "LF closes to RF",
  });

  it("emits one footwork attribute per parsed count with deterministic ids", () => {
    expect(scaffold).toHaveLength(6);
    expect(scaffold.map((a) => a.id)).toEqual([
      "wdsf-hesitation-change-waltz-s1",
      "wdsf-hesitation-change-waltz-s2",
      "wdsf-hesitation-change-waltz-s3",
      "wdsf-hesitation-change-waltz-s4",
      "wdsf-hesitation-change-waltz-s5",
      "wdsf-hesitation-change-waltz-s6",
    ]);
    expect(scaffold.every((a) => a.kind === "footwork")).toBe(true);
    expect(scaffold.map((a) => a.count)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("puts start on step 1, finish on the last step, blanks between", () => {
    expect(scaffold[0]?.value).toBe("RF fwd (Closed Position)");
    expect(scaffold[5]?.value).toBe("LF closes to RF");
    expect(scaffold.slice(1, 5).every((a) => a.value === "")).toBe(true);
  });

  it("produces only attributes the strict write schema accepts", () => {
    for (const a of scaffold) {
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

describe("buildWdsfAttributes — authored figures (verified footwork)", () => {
  const natural = buildWdsfAttributes({
    figureType: "natural-turn",
    dance: "waltz",
    timing: "123 123",
    start: "RF fwd (Closed Position)",
    finish: "LF closes to RF",
  });

  it("emits a direction + footwork attribute per role for each of the 6 counts", () => {
    expect(natural).toHaveLength(6 * 2 * 2); // 6 counts × 2 roles × {direction, footwork}
    expect(natural.map((a) => a.count)).toEqual(
      [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3].concat([4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6]),
    );
    expect(new Set(natural.map((a) => a.kind))).toEqual(new Set(["direction", "footwork"]));
    expect(new Set(natural.map((a) => a.role))).toEqual(new Set(["leader", "follower"]));
  });

  it("the leader's count-1 step is a forward Heel-Toe, the follower's is a back Toe-Heel", () => {
    const at1 = (role: string, kind: string) =>
      natural.find((a) => a.count === 1 && a.role === role && a.kind === kind)?.value;
    expect(at1("leader", "direction")).toBe("forward");
    expect(at1("leader", "footwork")).toBe("HT");
    expect(at1("follower", "direction")).toBe("back");
    expect(at1("follower", "footwork")).toBe("TH");
  });

  it("captures the follower's heel turn on count 2 (close, Heel-Toe)", () => {
    const f2 = (kind: string) =>
      natural.find((a) => a.count === 2 && a.role === "follower" && a.kind === kind)?.value;
    expect(f2("direction")).toBe("close");
    expect(f2("footwork")).toBe("HT");
  });

  it("every authored attribute passes the strict write schema", () => {
    for (const a of natural) {
      expect(() => parseAttributeWrite(a, { dance: "waltz" })).not.toThrow();
    }
  });
});
