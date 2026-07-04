import { describe, expect, it } from "vitest";
import { DANCE_IDS } from "./dances";
import { LIBRARY_FIGURE_DATA } from "./library-data";

// ─────────────────────────────────────────────────────────────────────────
// Data-integrity guard for the hand-/generator-maintained library dataset
// (library-data.ts, 240+ rows regenerated from the ISTD/WDSF seed). Nothing
// type-checks the *values*, so a bad regen (an unknown dance, a non-slug
// figureType, a blank name, or an exact duplicate row) would ship silently and
// only surface as a runtime glitch — e.g. the figure-picker's React key warning
// when two rows collide. These assertions fail the suite at the source instead.
// ─────────────────────────────────────────────────────────────────────────

const DANCES = new Set<string>(DANCE_IDS);
// Catalog slug convention: lowercase alphanumerics joined by single hyphens
// (matches `slugify` output + the figureType catalog hyphen convention).
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("LIBRARY_FIGURE_DATA integrity", () => {
  it("has rows", () => {
    expect(LIBRARY_FIGURE_DATA.length).toBeGreaterThan(0);
  });

  it("every row has a known dance", () => {
    const bad = LIBRARY_FIGURE_DATA.filter((f) => !DANCES.has(f.dance));
    expect(bad.map((f) => `${f.dance}/${f.name}`)).toEqual([]);
  });

  it("every figureType is a non-empty catalog slug", () => {
    const bad = LIBRARY_FIGURE_DATA.filter((f) => !SLUG.test(f.figureType));
    expect(bad.map((f) => `${f.dance}:${f.figureType}`)).toEqual([]);
  });

  it("every name is non-empty (trimmed)", () => {
    const bad = LIBRARY_FIGURE_DATA.filter((f) => f.name.trim() === "");
    expect(bad.map((f) => `${f.dance}/${f.figureType}`)).toEqual([]);
  });

  it("every timing, when present, is a non-empty string", () => {
    const bad = LIBRARY_FIGURE_DATA.filter((f) => f.timing !== undefined && f.timing.trim() === "");
    expect(bad.map((f) => `${f.dance}/${f.name}`)).toEqual([]);
  });

  // The invariant the Assemble figure-picker relies on for its React list key.
  // A dance MAY repeat a figureType (a figure family — e.g. foxtrot has a base
  // "Reverse Turn" and a "Reverse Turn (incorporating Feather Finish)" variant,
  // both figureType "reverse-turn"), so the unique key is the full triple, not
  // figureType alone.
  it("(dance, figureType, name) is unique — no exact duplicate rows", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const f of LIBRARY_FIGURE_DATA) {
      const key = `${f.dance}::${f.figureType}::${f.name}`;
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });
});
