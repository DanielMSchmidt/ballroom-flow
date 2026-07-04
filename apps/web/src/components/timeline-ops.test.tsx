import type { Attribute } from "@ballroom/domain";
import { describe, expect, it } from "vitest";
import { durationLabel, resizeStepDuration, stepDuration } from "./timeline-ops";

const attr = (count: number, kind = "footwork", value = "heel"): Attribute => ({
  id: `${kind}-${count}-${value}`,
  kind,
  count,
  value,
  role: null,
  deletedAt: null,
});

describe("timeline-ops — durations", () => {
  it("derives a step's duration from the gap to the next placed count", () => {
    expect(stepDuration(1, [1, 1.5, 3])).toBe(0.5);
    expect(stepDuration(1.5, [1, 1.5, 3])).toBe(1.5);
    expect(stepDuration(3, [1, 1.5, 3])).toBe(1); // last step → a whole beat
  });

  it("labels durations with fraction glyphs", () => {
    expect(durationLabel(1)).toBe("1 beat");
    expect(durationLabel(0.5)).toBe("½ beat");
    expect(durationLabel(0.25)).toBe("¼ beat");
    expect(durationLabel(2)).toBe("2 beats");
  });
});

describe("timeline-ops — resizeStepDuration", () => {
  it("shifts every later step by the delta, preserving their gaps", () => {
    const attrs = [
      attr(1, "direction", "forward"),
      attr(2, "footwork", "toe"),
      attr(3, "rise", "up"),
    ];
    // Grow step 1 from 1 beat → 1.5 beats: later steps move +0.5.
    const next = resizeStepDuration(attrs, 1, 1.5);
    expect(next.find((a) => a.kind === "direction")?.count).toBe(1); // unchanged
    expect(next.find((a) => a.kind === "footwork")?.count).toBe(2.5);
    expect(next.find((a) => a.kind === "rise")?.count).toBe(3.5);
  });

  it("can shrink a step (negative delta) onto the 1/8 grid", () => {
    const attrs = [attr(1, "direction", "forward"), attr(2, "footwork", "toe")];
    const next = resizeStepDuration(attrs, 1, 0.5);
    expect(next.find((a) => a.kind === "footwork")?.count).toBe(1.5);
  });

  it("is a no-op for the last step (nothing to push)", () => {
    const attrs = [attr(1, "direction", "forward"), attr(2, "footwork", "toe")];
    expect(resizeStepDuration(attrs, 2, 3)).toBe(attrs);
  });
});
