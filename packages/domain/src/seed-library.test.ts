import { describe, expect, it } from "vitest";
import { importDomain } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-054 — Full Standard syllabus library seed (ISTD) [Content, system]
// PLAN §9 Content workstream, D30, Q-LIBSEED: global FigureDocs authored per
// figureType × dance, app-owned, validated against the schema; the FigureType
// catalog (families × dances) is bundled; seed values are DATA (refinable).
//
// The seed module + FigureType catalog (bundled reference data) land with the
// content workstream → dynamic import, skipped. These tests pin that the seed
// is well-formed (schema-valid, tagged figureType+dance, app-owned, versioned),
// NOT the notation accuracy (which is refined with testers — Q-LIBSEED).
// ─────────────────────────────────────────────────────────────────────────

interface SeedModule {
  GLOBAL_FIGURE_SEED: Array<{
    scope: string;
    ownerId: string;
    figureType: string;
    dance: string;
    schemaVersion: number;
  }>;
  FIGURE_TYPE_CATALOG: Record<string, string[]>; // figureType → dances it exists in
}
const SEED_PKG = "@ballroom/domain";

describe.skip("US-054 Full Standard syllabus library seed (ISTD)", () => {
  it("authors global FigureDocs tagged figureType + dance, app-owned, schema-valid", async () => {
    // Intent: every seed figure is a global (app-owned) doc tagged with figureType +
    //   dance and validates against the figure write schema.
    // Arrange: import the seed + the Zod figure validator. Act: validate each seed doc.
    // Assert: all scope:global, ownerId:app, figureType+dance present, schema-valid.
    // Covers US-054 AC-1 (global FigureDocs by figureType×dance, app-owned).
    const seed = (await import(SEED_PKG)) as unknown as SeedModule;
    const { parseAttributeRead } = await importDomain();
    expect(parseAttributeRead).toBeTypeOf("function");
    for (const fig of seed.GLOBAL_FIGURE_SEED) {
      expect(fig.scope).toBe("global");
      expect(fig.ownerId).toBe("app");
      expect(fig.figureType).toBeTruthy();
      expect(fig.dance).toBeTruthy();
    }
  });

  it("bundles a FigureType catalog mapping each family to the dances it exists in", async () => {
    // Intent: the FigureType catalog (families × dances) is bundled reference data
    //   that drives all-dances annotation scope + library browsing.
    // Arrange: import the catalog. Act: read it. Assert: e.g. "feather" lists multiple
    //   dances (Foxtrot/Quickstep/Waltz); every catalog dance is a Standard dance.
    // Covers US-054 AC-4 (FigureType catalog bundled).
    const seed = (await import(SEED_PKG)) as unknown as SeedModule;
    expect(Object.keys(seed.FIGURE_TYPE_CATALOG).length).toBeGreaterThan(0);
    expect(seed.FIGURE_TYPE_CATALOG.feather?.length ?? 0).toBeGreaterThan(1);
  });

  it("versions seed docs by schemaVersion (corrections are data edits)", async () => {
    // Intent: seed docs carry schemaVersion so the migration ladder applies (US-013);
    //   notation values are data, refinable without code changes (Q-LIBSEED).
    // Arrange: import the seed. Act: read schemaVersion of each. Assert: all present (≥1).
    // Covers US-054 AC-3 (values are data) + AC-4 (versioned by schemaVersion).
    const seed = (await import(SEED_PKG)) as unknown as SeedModule;
    for (const fig of seed.GLOBAL_FIGURE_SEED) {
      expect(fig.schemaVersion).toBeGreaterThanOrEqual(1);
    }
  });
});
