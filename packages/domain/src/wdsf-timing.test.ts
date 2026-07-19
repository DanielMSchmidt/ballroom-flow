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

  it("a - extends the preceding step by one beat without emitting a step", () => {
    // WDSF technique-book rows can span >2 beats (e.g. the Viennese Waltz Drag
    // Hesitation's drag covers beats 3-5): S/Q/& alone cannot express a 3-beat
    // step, so `-` holds the cursor one extra beat. "SS-Q" = steps on 1, 3
    // (held through 5), 6.
    expect(parseWdsfTiming("SS-Q")).toEqual([1, 3, 6]);
    expect(parseWdsfTiming("QQQSS-Q")).toEqual([1, 2, 3, 4, 6, 9]);
    // Trailing holds only stretch the final step — no extra counts.
    expect(parseWdsfTiming("SQS-")).toEqual([1, 3, 4]);
    expect(parseWdsfTiming("SQS----")).toEqual([1, 3, 4]);
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
  // A figureType with no figure-steps.ts entry (synthetic — the real catalog is now
  // fully book-charted, so we pin the scaffold path with a type that never charts).
  const scaffold = buildWdsfAttributes({
    figureType: "uncharted-figure",
    dance: "waltz",
    timing: "123 123",
    start: "RF fwd (Closed Position)",
    finish: "LF closes to RF",
  });

  it("emits one footwork attribute per parsed count with deterministic ids", () => {
    expect(scaffold).toHaveLength(6);
    expect(scaffold.map((a) => a.id)).toEqual([
      "wdsf-uncharted-figure-waltz-s1",
      "wdsf-uncharted-figure-waltz-s2",
      "wdsf-uncharted-figure-waltz-s3",
      "wdsf-uncharted-figure-waltz-s4",
      "wdsf-uncharted-figure-waltz-s5",
      "wdsf-uncharted-figure-waltz-s6",
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
    // The chart carries richer attributes too (rise/sway/turn/position/CBM), so assert the
    // direction+footwork CORE is exactly one per role per count — that's the timeline spine.
    const core = natural.filter((a) => a.kind === "direction" || a.kind === "footwork");
    expect(core).toHaveLength(6 * 2 * 2); // 6 counts × 2 roles × {direction, footwork}
    expect(core.map((a) => a.count)).toEqual(
      [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3].concat([4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6]),
    );
    expect(new Set(core.map((a) => a.role))).toEqual(new Set(["leader", "follower"]));
  });

  it("the leader's count-1 step is a forward Heel-Flat, the follower's is a back Toe-Heel", () => {
    // WDSF Technique Book — Waltz (2nd ed. 2013), Natural Turn: the forward drive
    // step's Foot Action is "H Flat" (not the ISTD "HT").
    const at1 = (role: string, kind: string) =>
      natural.find((a) => a.count === 1 && a.role === role && a.kind === kind)?.value;
    expect(at1("leader", "direction")).toBe("forward");
    expect(at1("leader", "footwork")).toBe("H flat");
    expect(at1("follower", "direction")).toBe("back");
    expect(at1("follower", "footwork")).toBe("TH");
  });

  it("carries the chart's richer rise / sway / turn / CBM attributes", () => {
    // The natural turn's real technique per the WDSF book: rise commences on count 1
    // (shared), the leader's ¼R is printed "between 1 and 2" (recorded on count 2 —
    // the chart convention puts a turn on the row it is taken INTO), CBM on count 1,
    // sway right on count 2.
    const shared = (count: number, kind: string) =>
      natural.find((a) => a.count === count && a.role === null && a.kind === kind)?.value;
    const lead = (count: number, kind: string) =>
      natural.find((a) => a.count === count && a.role === "leader" && a.kind === kind)?.value;
    expect(shared(1, "rise")).toBe("commence");
    expect(lead(2, "turn")).toBe("quarter_R");
    expect(lead(2, "sway")).toBe("to_R");
    expect(
      natural.some(
        (a) =>
          a.count === 1 && a.role === "leader" && a.kind === "bodyActions" && a.value === "CBM",
      ),
    ).toBe(true);
  });

  it("every authored attribute passes the strict write schema", () => {
    for (const a of natural) {
      expect(() => parseAttributeWrite(a, { dance: "waltz" })).not.toThrow();
    }
  });

  it("emits neither the WDSF rotation nor head prose columns (removed ⟳2026-07-10)", () => {
    // The books' Rotation and head-position ("Extension") prose columns are no
    // longer modelled — `turn` is the canonical rotation (D33) and the prose
    // doesn't earn a place in the structured step model; both transcriptions
    // stay in the chart seed for provenance only.
    expect(natural.some((a) => a.kind === "rotation")).toBe(false);
    expect(natural.some((a) => a.kind === "head")).toBe(false);
  });
});

describe("buildWdsfAttributes — role-asymmetric charts (per-role step grids)", () => {
  // The Waltz Double Reverse Spin: the leader dances 3 steps (1 2 3) while the
  // follower dances 4 (1 2 & 3) — the book charts her extra "&" step, and the
  // union timing grid carries a follower-only count at 2.5.
  const drs = buildWdsfAttributes({
    figureType: "double-reverse-spin",
    dance: "waltz",
    timing: "12&3",
  });

  it("emits follower attributes on the follower-only count and none for the leader", () => {
    const at25 = drs.filter((a) => a.count === 2.5);
    expect(at25.length).toBeGreaterThan(0);
    // Only follower (and couple-shared) attributes — the leader has no step here.
    expect(at25.some((a) => a.role === "leader")).toBe(false);
    expect(at25.some((a) => a.role === "follower")).toBe(true);
    expect(at25.some((a) => a.kind === "direction" && a.value === "side")).toBe(true);
  });

  it("still emits both roles on the shared counts", () => {
    const roles1 = new Set(drs.filter((a) => a.count === 1 && a.role).map((a) => a.role));
    expect(roles1).toEqual(new Set(["leader", "follower"]));
  });
});
