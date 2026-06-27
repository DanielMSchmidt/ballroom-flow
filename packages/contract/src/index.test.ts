import { describe, expect, it } from "vitest";
import { zCreateFigure, zRegistryKind, zSearchResults, zTemplateList } from "./index";

describe("zCreateFigure", () => {
  it("accepts an optional attributes timeline, defaulting to []", () => {
    const base = {
      figureRef: "fig_1",
      name: "Natural Turn",
      dance: "waltz",
      figureType: "natural-turn",
      routineId: "rt_1",
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
      routineId: "rt_1",
      attributes: [{ id: "a1", count: 1 }], // missing kind/value
    };
    expect(zCreateFigure.safeParse(bad).success).toBe(false);
  });
});

it("US-043 validates a custom registry kind", () => {
  const ok = zRegistryKind.safeParse({
    kind: "energy",
    label: "Energy",
    color: "#c0563f",
    cardinality: "single",
    valueType: "enum",
    values: ["low", "high"],
    builtin: false,
  });
  expect(ok.success).toBe(true);
});

it("US-046 shapes search results", () => {
  const ok = zSearchResults.safeParse({
    results: [{ docRef: "r1", type: "routine", title: "My Foxtrot", dance: "foxtrot" }],
  });
  expect(ok.success).toBe(true);
});

it("US-045 shapes the template list", () => {
  const ok = zTemplateList.safeParse({
    templates: [{ docRef: "t1", title: "Sample", dance: "foxtrot", role: "viewer", updatedAt: 1 }],
  });
  expect(ok.success).toBe(true);
});
