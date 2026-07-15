// mergeLiveBookmarkedFigures — the Add-figure picker's read-your-writes merge
// (docs/system/architecture.md § D1 — the index & projections, "reads split by
// audience"). A bookmark lands in the live account doc instantly, but
// /api/figures/mine reads the alarm-written library_entry projection — so the
// picker merges live-bookmarked figures resolved from the open routine's placed
// figure docs over the REST list, deduped by docRef (the REST row wins), the
// same rule as the Journal's mergeLiveFamilyNotes/mergePendingEntries (PR #255).
import type { FigureDoc } from "@weavesteps/domain";
import { describe, expect, it } from "vitest";
import { type MineFigure, mergeLiveBookmarkedFigures, mergeLiveCatalogBookmarks } from "./figures";

const fig = (id: string, name: string, over: Partial<FigureDoc> = {}): FigureDoc => ({
  id,
  scope: "account",
  ownerId: "u",
  figureType: `${id}-type`,
  dance: "foxtrot",
  name,
  source: "custom",
  attributes: [],
  schemaVersion: 1,
  deletedAt: null,
  ...over,
});

const mineRow = (docRef: string, over: Partial<MineFigure> = {}): MineFigure => ({
  docRef,
  title: "My Lunge",
  figureType: "my-lunge",
  dance: "foxtrot",
  baseFigureRef: null,
  usedInCount: 3,
  ...over,
});

describe("mergeLiveBookmarkedFigures", () => {
  it("synthesizes a row for a live-bookmarked placed figure the /mine list lacks", () => {
    const merged = mergeLiveBookmarkedFigures([], new Set(["fig_mine"]), [
      { figure: fig("fig_mine", "My Lunge", { baseFigureRef: "global:foxtrot:feather-step" }) },
    ]);
    expect(merged).toEqual([
      {
        docRef: "fig_mine",
        title: "My Lunge",
        figureType: "fig_mine-type",
        dance: "foxtrot",
        baseFigureRef: "global:foxtrot:feather-step",
        // The echo can only see the open routine — it's referenced at least here.
        usedInCount: 1,
      },
    ]);
  });

  it("dedupes by docRef — the REST row (joined projection fields) wins", () => {
    const rest = mineRow("fig_mine");
    const merged = mergeLiveBookmarkedFigures([rest], new Set(["fig_mine"]), [
      { figure: fig("fig_mine", "Renamed Locally") },
      // The same figure placed twice still yields one row.
      { figure: fig("fig_mine", "Renamed Locally") },
    ]);
    expect(merged).toEqual([rest]);
  });

  it("skips placed figures that aren't bookmarked, and unresolved (null) figures", () => {
    const merged = mergeLiveBookmarkedFigures([], new Set(["fig_mine"]), [
      { figure: fig("fig_glue", "Glue Step") },
      { figure: null },
    ]);
    expect(merged).toEqual([]);
  });

  it("skips catalog (global:) refs — their preset row already lists them", () => {
    const merged = mergeLiveBookmarkedFigures([], new Set(["global:foxtrot:feather-step"]), [
      {
        figure: fig("global:foxtrot:feather-step", "Feather Step", {
          scope: "global",
          source: "library",
        }),
      },
    ]);
    expect(merged).toEqual([]);
  });
});

describe("mergeLiveCatalogBookmarks", () => {
  it("synthesizes a catalog row (bundled metadata) for a live global ref /mine lacks", () => {
    const merged = mergeLiveCatalogBookmarks([], ["global:foxtrot:feather-step"]);
    expect(merged).toEqual([
      {
        docRef: "global:foxtrot:feather-step",
        title: "Feather Step",
        figureType: "feather-step",
        dance: "foxtrot",
        baseFigureRef: null, // the catalog original, not a variant of anything
        usedInCount: 0,
      },
    ]);
  });

  it("dedupes by docRef — the REST row (real usedInCount) wins", () => {
    const rest = mineRow("global:foxtrot:feather-step", {
      title: "Feather Step",
      figureType: "feather-step",
      usedInCount: 2,
    });
    expect(mergeLiveCatalogBookmarks([rest], ["global:foxtrot:feather-step"])).toEqual([rest]);
  });

  it("skips account-figure refs — this surface has no live doc to resolve them from", () => {
    expect(mergeLiveCatalogBookmarks([], ["fig_mine"])).toEqual([]);
  });
});
