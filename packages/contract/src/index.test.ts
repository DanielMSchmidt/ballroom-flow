import { describe, expect, it } from "vitest";
import { zCreateFigure } from "./index";

describe("zCreateFigure", () => {
  it("accepts an optional attributes timeline, defaulting to []", () => {
    const base = {
      figureRef: "fig_1",
      name: "Natural Turn",
      dance: "waltz",
      figureType: "natural-turn",
    };
    expect(zCreateFigure.parse(base).attributes).toEqual([]);

    const withAttrs = zCreateFigure.parse({
      ...base,
      attributes: [
        { id: "a1", kind: "step", count: 1, role: null, value: "RF fwd", deletedAt: null },
      ],
    });
    expect(withAttrs.attributes).toHaveLength(1);
  });

  it("rejects a structurally invalid attribute", () => {
    const bad = {
      figureRef: "fig_1",
      name: "X",
      dance: "waltz",
      figureType: "x",
      attributes: [{ id: "a1", count: 1 }], // missing kind/value
    };
    expect(zCreateFigure.safeParse(bad).success).toBe(false);
  });
});
