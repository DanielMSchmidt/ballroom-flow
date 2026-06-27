import { describe, expect, it } from "vitest";
import { LIBRARY_FIGURES } from "./library";
import { buildGoldenWaltzBasic } from "./starter-routine";

const seq = () => {
  let n = 0;
  return () => `id_${++n}`;
};

describe("buildGoldenWaltzBasic", () => {
  it("builds one waltz routine with a single Basic section of 6 placements", () => {
    const { routine, missing } = buildGoldenWaltzBasic("u_1", seq());
    expect(missing).toEqual([]);
    expect(routine.title).toBe("Golden Waltz Basic");
    expect(routine.dance).toBe("waltz");
    expect(routine.ownerId).toBe("u_1");
    expect(routine.sections).toHaveLength(1);
    const section = routine.sections[0];
    expect(section).toBeDefined();
    expect(section?.name).toBe("Basic");
    expect(section?.placements).toHaveLength(6);
    expect(routine.annotations).toEqual([]);
    expect(routine.schemaVersion).toBe(1);
  });

  it("creates 6 owned waltz figures in the listed order, each with library attributes", () => {
    const { figures } = buildGoldenWaltzBasic("u_1", seq());
    const order = [
      "closed-change-on-rf",
      "natural-turn",
      "closed-change-on-lf",
      "reverse-turn",
      "whisk",
      "chasse-from-pp",
    ];
    expect(figures.map((f) => f.figureType)).toEqual(order);
    for (const f of figures) {
      expect(f.dance).toBe("waltz");
      expect(f.ownerId).toBe("u_1");
      expect(f.scope).toBe("account");
      expect(f.source).toBe("custom");
      // attributes copied verbatim from the library entry
      const lib = LIBRARY_FIGURES.find((l) => l.dance === "waltz" && l.figureType === f.figureType);
      expect(lib).toBeDefined();
      expect(f.attributes).toEqual(lib?.attributes ?? []);
      expect(f.attributes.length).toBeGreaterThan(0);
      // the library's own (canonical) name is used, not a hardcoded one
      expect(f.name).toBe(lib?.name);
    }
  });

  it("links each placement to its figure by figureRef, with all ids distinct", () => {
    const { routine, figures } = buildGoldenWaltzBasic("u_1", seq());
    expect(routine.sections.length).toBeGreaterThan(0);
    const section = routine.sections[0];
    if (!section) throw new Error("section should exist");
    const placementRefs = section.placements.map((p) => p.figureRef);
    expect(placementRefs).toEqual(figures.map((f) => f.id));
    const allIds = [
      routine.id,
      section.id,
      ...section.placements.map((p) => p.id),
      ...figures.map((f) => f.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length); // no collisions
  });
});
