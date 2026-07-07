import { describe, expect, it } from "vitest";
import { DANCE_IDS } from "./dances";
import { FIGURE_STEPS } from "./figure-steps";
import { LIBRARY_FIGURES } from "./library";

// ─────────────────────────────────────────────────────────────────────────
// US-054 — Full Standard syllabus library seed [Content, system]
// PLAN §9 Content workstream, D30, Q-LIBSEED: the full Standard syllabus is
// seeded per figureType × dance, app-owned, validated against the schema.
//
// UNSKIPPED 2026-07-06: the owner's WDSF Technique Books (2nd ed., May 2013)
// arrived and the whole five-book syllabus was charted from them (the external
// dependency PLAN §9 named). Reshaped from the original draft to the AS-BUILT
// v5 architecture: there is no GLOBAL_FIGURE_SEED module — the bundled catalog
// (LIBRARY_FIGURES) + charted steps (FIGURE_STEPS) are the seed data, and the
// worker's additive-only `seedGlobalFigures` imports them into real app-owned
// global docs (covered by the worker suite). These tests pin that the seed
// data is well-formed and full-syllabus, NOT notation accuracy (refined with
// testers — Q-LIBSEED).
// ─────────────────────────────────────────────────────────────────────────

describe("US-054 Full Standard syllabus library seed (WDSF technique books)", () => {
  it("seeds the full syllabus: every figure tagged figureType × dance, unique per dance", () => {
    // Covers US-054 AC-1 (figures organized by figureType × dance).
    const seen = new Set<string>();
    for (const fig of LIBRARY_FIGURES) {
      expect(fig.figureType, `${fig.name} has a figureType`).toBeTruthy();
      expect(DANCE_IDS, `${fig.figureType} dance`).toContain(fig.dance);
      const key = `${fig.dance}:${fig.figureType}`;
      expect(seen.has(key), `${key} unique`).toBe(false);
      seen.add(key);
    }
  });

  it("covers all five Standard dances at technique-book breadth", () => {
    // The WDSF books chart 37-40 figures per dance (Waltz 37, VW 37, Tango 40,
    // Foxtrot 39, Quickstep 39); merged with the ISTD identity set the catalog
    // carries 260+ figures, and no dance — Viennese Waltz included — is thin.
    expect(LIBRARY_FIGURES.length).toBeGreaterThanOrEqual(260);
    for (const dance of DANCE_IDS) {
      const n = LIBRARY_FIGURES.filter((f) => f.dance === dance).length;
      expect(n, `${dance} breadth`).toBeGreaterThanOrEqual(35);
    }
  });

  it("carries verified per-step both-role charts for the technique-book figures", () => {
    // Covers US-054 AC-2/AC-3 (book-verified content; values are data). Every
    // charted figure is keyed dance:figureType; the step-count guard
    // (figure-steps.test.ts) keeps each chart aligned to its timing.
    expect(Object.keys(FIGURE_STEPS).length).toBeGreaterThanOrEqual(210);
  });

  it("keeps figureType a cross-dance family key (all-dances annotation scope)", () => {
    // Covers US-054 AC-4 (the figureType catalog spans dances — e.g. the
    // Natural Turn family exists in several Standard dances).
    const naturalTurnDances = new Set(
      LIBRARY_FIGURES.filter((f) => f.figureType === "natural-turn").map((f) => f.dance),
    );
    expect(naturalTurnDances.size).toBeGreaterThanOrEqual(3);
  });
});
