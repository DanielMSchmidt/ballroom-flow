import { describe, expect, it } from "vitest";
import {
  LIBRARY_FIGURES,
  type LibraryFigure,
  libraryFiguresForDance,
  libraryGroupsForDance,
} from "./library";

// US-032 — the application-global figure library (client-bundled catalog shaped
// from the ISTD Standard syllabus seed). PLAN §4.2, D30. The catalog is pure
// reference data; these prove the dance-scoped read + figureType grouping the
// picker and Library browse rely on.

describe("figure library catalog", () => {
  it("carries canonical figures across the five Standard dances", () => {
    expect(LIBRARY_FIGURES.length).toBeGreaterThan(50);
    const dances = new Set(LIBRARY_FIGURES.map((f) => f.dance));
    expect(dances).toEqual(new Set(["waltz", "viennese_waltz", "quickstep", "foxtrot", "tango"]));
  });

  it("returns only a dance's figures, with stable identity fields", () => {
    const foxtrot = libraryFiguresForDance("foxtrot");
    expect(foxtrot.every((f) => f.dance === "foxtrot")).toBe(true);
    // The Feather Step is the canonical Foxtrot opener (figureType is its slug).
    const feather = foxtrot.find((f) => /feather step/i.test(f.name));
    expect(feather).toBeTruthy();
    expect((feather as LibraryFigure).figureType).toBe("feather-step");
    // A waltz-only figure must not leak into the foxtrot list.
    expect(foxtrot.some((f) => /natural spin turn/i.test(f.name))).toBe(false);
  });

  it("groups a dance's figures by figureType for the library browse", () => {
    const groups = libraryGroupsForDance("waltz");
    expect(groups.length).toBeGreaterThan(0);
    // Each group is one figureType with at least one figure, all of this dance.
    for (const g of groups) {
      expect(g.figures.length).toBeGreaterThan(0);
      expect(g.figures.every((f) => f.figureType === g.figureType && f.dance === "waltz")).toBe(
        true,
      );
    }
    expect(groups.some((g) => g.figureType === "natural-turn")).toBe(true);
  });
});
