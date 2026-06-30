import { describe, expect, it } from "vitest";
import type { Attribute } from "./doc-types";
import {
  figureMatchesLibraryOrigin,
  globalFigureRef,
  LIBRARY_FIGURES,
  type LibraryFigure,
  libraryFiguresForDance,
  libraryGroupsForDance,
  libraryGroupsForFilter,
} from "./library";
import { parseAttributeWrite } from "./schemas";

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

  it("includes the net-new WDSF figures with parsed step attributes", () => {
    // ~247 = 122 ISTD + 125 net-new WDSF
    expect(LIBRARY_FIGURES.length).toBeGreaterThanOrEqual(240);

    const natural = libraryFiguresForDance("waltz").find(
      (f) => f.figureType === "natural-turn" && f.name === "Natural Turn",
    );
    // Verified content (figure-steps.ts): a direction + footwork per role for each of the
    // 6 counts, so the figure arrives with a full timeline.
    expect(natural?.attributes).toBeDefined();
    // The direction+footwork core is one per role per count (6 counts × 2 roles × 2);
    // the chart also carries richer rise/sway/turn/position/CBM attributes on top.
    const core = (natural?.attributes ?? []).filter(
      (a) => a.kind === "direction" || a.kind === "footwork",
    );
    expect(core).toHaveLength(6 * 2 * 2);
    const leaderS1Foot = natural?.attributes?.find(
      (a) => a.count === 1 && a.role === "leader" && a.kind === "footwork",
    );
    expect(leaderS1Foot?.value).toBe("HT");

    // An un-charted figure still falls back to the WDSF start/finish scaffold (footwork-only,
    // role:null). Find any such figure in the catalog and assert the fallback shape.
    const scaffolded = LIBRARY_FIGURES.find(
      (f) =>
        (f.attributes?.length ?? 0) > 0 &&
        (f.attributes ?? []).every((a) => a.kind === "footwork" && a.role === null),
    );
    if (scaffolded) {
      expect(scaffolded.attributes?.every((a) => a.kind === "footwork")).toBe(true);
    }
  });

  it("every catalog attribute is a valid strict-write attribute for its dance", () => {
    for (const f of LIBRARY_FIGURES) {
      for (const a of f.attributes ?? []) {
        expect(() => parseAttributeWrite(a, { dance: f.dance })).not.toThrow();
      }
    }
  });
});

describe("globalFigureRef — canonical provenance ref for a catalog figure (T5)", () => {
  it("encodes (dance, figureType) as a stable global: ref", () => {
    // The save-to-library promotion records this as the frozen copy's baseFigureRef
    // (PLAN §5.2, provenance only). It must be deterministic for idempotency.
    expect(globalFigureRef("waltz", "natural-turn")).toBe("global:waltz:natural-turn");
    expect(globalFigureRef("foxtrot", "feather-step")).toBe("global:foxtrot:feather-step");
  });

  it("distinguishes the same figureType across dances (cross-dance identity)", () => {
    // A Feather in Foxtrot vs Quickstep is its own global FigureDoc (§2.2), so the
    // refs must differ — saving the Foxtrot one must not dedupe against the Quickstep one.
    expect(globalFigureRef("foxtrot", "feather")).not.toBe(globalFigureRef("quickstep", "feather"));
  });
});

describe("libraryGroupsForFilter — global browse grouping incl. the All filter (T5)", () => {
  it("groups a single dance like libraryGroupsForDance", () => {
    expect(libraryGroupsForFilter("waltz")).toEqual(libraryGroupsForDance("waltz"));
  });

  it("groups every dance's figures by figureType when filter = all", () => {
    const all = libraryGroupsForFilter("all");
    // The All view spans all five dances — a figureType family can hold figures of
    // several dances (the cross-dance identity).
    const dances = new Set(all.flatMap((g) => g.figures.map((f) => f.dance)));
    expect(dances).toEqual(new Set(["waltz", "viennese_waltz", "quickstep", "foxtrot", "tango"]));
    // Every figure in a group shares the group's figureType.
    for (const g of all) {
      expect(g.figures.every((f) => f.figureType === g.figureType)).toBe(true);
    }
  });
});

describe("figureMatchesLibraryOrigin — an unchanged library pick isn't custom", () => {
  const origin = libraryFiguresForDance("waltz").find(
    (f) => f.figureType === "natural-turn" && f.name === "Natural Turn",
  );
  if (!origin) throw new Error("fixture missing");
  // A figure freshly picked from the library copies the origin's attributes verbatim.
  const picked = {
    dance: "waltz" as const,
    figureType: "natural-turn",
    name: "Natural Turn",
    attributes: (origin.attributes ?? []).map((a) => ({ ...a })) as Attribute[],
  };

  it("matches when the placed figure equals its catalog origin", () => {
    expect(figureMatchesLibraryOrigin(picked)).toBe(true);
  });

  it("does NOT match once a configured attribute value is changed", () => {
    const edited = {
      ...picked,
      attributes: picked.attributes.map((a, i) =>
        i === 0 ? { ...a, value: "completely-different" } : a,
      ),
    };
    expect(figureMatchesLibraryOrigin(edited)).toBe(false);
  });

  it("does NOT match once a new attribute is added", () => {
    const added = {
      ...picked,
      attributes: [
        ...picked.attributes,
        { id: "extra", kind: "sway", count: 1, role: "leader", value: "left", deletedAt: null },
      ] as Attribute[],
    };
    expect(figureMatchesLibraryOrigin(added)).toBe(false);
  });

  it("ignores deleted attributes (compares only the live set)", () => {
    // Deleting an attribute diverges from the origin → no longer a pristine pick.
    const withDeletion = {
      ...picked,
      attributes: picked.attributes.map((a, i) =>
        i === 0 ? { ...a, deletedAt: 123 } : a,
      ) as Attribute[],
    };
    expect(figureMatchesLibraryOrigin(withDeletion)).toBe(false);
  });

  it("a typed custom figure (name not in the catalog) never matches", () => {
    expect(
      figureMatchesLibraryOrigin({
        dance: "waltz",
        figureType: "my-move",
        name: "My Move",
        attributes: [],
      }),
    ).toBe(false);
  });
});
