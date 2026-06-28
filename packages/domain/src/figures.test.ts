import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type FigureRow,
  type LibraryFigure,
  type RoutineTree,
  resolveFigure,
  selectFigureView,
} from "./figures";
import { remoteError, remotePending, remoteSuccess } from "./remote-data";

const libRow: FigureRow = {
  id: "fig-1",
  name: "Natural Turn",
  source: "library",
  libraryFigureId: "lib-natural-turn",
};
const customRow: FigureRow = {
  id: "fig-2",
  name: "My Combo",
  source: "custom",
  libraryFigureId: null,
};
const catalog = new Map<string, LibraryFigure>([
  ["lib-natural-turn", { id: "lib-natural-turn", name: "Natural Turn (catalog)" }],
]);

describe("resolveFigure", () => {
  it("returns loading when the row is not available yet (not 'unknown')", () => {
    expect(resolveFigure(undefined, catalog)).toEqual({ status: "loading" });
  });

  it("resolves a library figure with its catalog entry", () => {
    const view = resolveFigure(libRow, catalog);
    expect(view.status).toBe("resolved");
    if (view.status === "resolved") {
      expect(view.library?.id).toBe("lib-natural-turn");
      // Part A: identity comes from the ROW, not the catalog.
      expect(view.name).toBe("Natural Turn");
    }
  });

  it("resolves a custom figure with no catalog entry", () => {
    const view = resolveFigure(customRow, catalog);
    expect(view).toEqual({
      status: "resolved",
      name: "My Combo",
      figure: customRow,
      library: null,
    });
  });

  it("degrades gracefully when the catalog has no match (version skew)", () => {
    const orphan: FigureRow = { ...libRow, libraryFigureId: "lib-missing" };
    const view = resolveFigure(orphan, catalog);
    expect(view.status).toBe("unresolved");
    if (view.status === "unresolved") {
      // Still shows the figure's real name — never a dead "Unknown figure".
      expect(view.name).toBe("Natural Turn");
      expect(view.libraryFigureId).toBe("lib-missing");
    }
  });

  it("never loses the row's name (property)", () => {
    const arbRow: fc.Arbitrary<FigureRow> = fc.record({
      id: fc.string(),
      name: fc.string(),
      source: fc.constantFrom("library", "custom"),
      libraryFigureId: fc.option(fc.string(), { nil: null }),
    });
    fc.assert(
      fc.property(arbRow, (row) => {
        const view = resolveFigure(row, catalog);
        if (view.status === "loading") return false; // a defined row is never loading
        expect(view.name).toBe(row.name);
        return true;
      }),
    );
  });
});

describe("selectFigureView", () => {
  const tree: RoutineTree = { figures: { [libRow.id]: libRow } };

  it("is loading while the tree is pending", () => {
    expect(selectFigureView(remotePending<RoutineTree>(), libRow.id, catalog)).toEqual({
      status: "loading",
    });
  });

  it("is loading while the tree is in error (routine-level UI owns the error)", () => {
    expect(selectFigureView(remoteError<RoutineTree>(new Error("x")), libRow.id, catalog)).toEqual({
      status: "loading",
    });
  });

  it("is loading for a figure absent from a loaded tree (not 'unknown')", () => {
    expect(selectFigureView(remoteSuccess(tree), "nope", catalog).status).toBe("loading");
  });

  it("resolves a figure present in a loaded tree", () => {
    expect(selectFigureView(remoteSuccess(tree), libRow.id, catalog).status).toBe("resolved");
  });
});
