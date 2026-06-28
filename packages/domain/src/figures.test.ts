import { describe, expect, it } from "vitest";
import { catalogFigureId, STANDARD_CATALOG } from "./catalog";
import {
  chartedFiguresForDance,
  getLibraryFigure,
  instantiateFigure,
  isCharted,
  LIBRARY_FIGURES,
  libraryFiguresForDance,
} from "./figures";
import { ALL_DANCES, getSlot } from "./vocabulary";

describe("library data quality", () => {
  it("ships the full Standard catalogue", () => {
    // Charted figures + every catalogue stub, deduped.
    expect(LIBRARY_FIGURES.length).toBeGreaterThanOrEqual(STANDARD_CATALOG.length);
    for (const dance of ALL_DANCES) {
      if (dance === "tango" || dance === "viennese_waltz") continue; // exercised below too
      expect(libraryFiguresForDance(dance).length, dance).toBeGreaterThan(0);
    }
  });

  it("at least one figure per Standard dance is in the catalogue", () => {
    for (const dance of ["waltz", "tango", "viennese_waltz", "foxtrot", "quickstep"] as const) {
      expect(libraryFiguresForDance(dance).length, dance).toBeGreaterThan(0);
    }
  });

  it("every CHARTED figure has both charts, and every step carries valid footwork", () => {
    const footValues = new Set(getSlot("foot")?.values.map((v) => v.value));
    const charted = LIBRARY_FIGURES.filter(isCharted);
    expect(charted.length).toBeGreaterThan(0);
    for (const fig of charted) {
      expect(fig.leaderSteps.length, `${fig.id} leader`).toBeGreaterThan(0);
      expect(fig.followerSteps.length, `${fig.id} follower`).toBeGreaterThan(0);
      for (const role of ["leaderSteps", "followerSteps"] as const) {
        for (const [i, step] of fig[role].entries()) {
          expect(step.foot, `${fig.id} ${role}[${i}] footwork present`).toBeTruthy();
          expect(
            footValues.has(step.foot as string),
            `${fig.id} ${role}[${i}] = ${step.foot}`,
          ).toBe(true);
        }
      }
    }
  });

  it("un-charted stubs carry catalogue identity but no fabricated steps", () => {
    const stubs = LIBRARY_FIGURES.filter((f) => !isCharted(f));
    expect(stubs.length).toBeGreaterThan(0);
    for (const fig of stubs) {
      expect(fig.name.length, fig.id).toBeGreaterThan(0);
      expect(fig.level, fig.id).toBeTruthy();
      expect(fig.leaderSteps).toHaveLength(0);
      expect(fig.followerSteps).toHaveLength(0);
    }
  });

  it("ids are unique", () => {
    const ids = LIBRARY_FIGURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a charted figure suppresses its name-matched catalogue stub (no duplicate)", () => {
    // "Natural Turn" is charted for waltz; the catalogue also lists it — only one survives.
    const id = catalogFigureId("waltz", "Natural Turn");
    const matches = LIBRARY_FIGURES.filter((fig) => fig.id === id);
    expect(matches).toHaveLength(1);
    expect(isCharted(matches[0] as (typeof matches)[number])).toBe(true);
  });
});

describe("instantiateFigure", () => {
  it("produces a deep copy linked to the library figure", () => {
    const lib = getLibraryFigure("waltz.natural_turn");
    if (!lib) throw new Error("fixture missing");
    const inst = instantiateFigure(lib, "fig-1");

    expect(inst.libraryFigureId).toBe("waltz.natural_turn");
    expect(inst.leaderSteps).toEqual(lib.leaderSteps);

    // Mutating the instance must not bleed into the shared catalog.
    const first = inst.leaderSteps[0];
    if (first) first.foot = "T";
    expect(lib.leaderSteps[0]?.foot).toBe("HT");
  });

  it("instantiating an un-charted stub yields empty charts to fill in", () => {
    const stub = LIBRARY_FIGURES.find((f) => !isCharted(f));
    if (!stub) throw new Error("expected a stub");
    const inst = instantiateFigure(stub, "fig-2");
    expect(inst.libraryFigureId).toBe(stub.id);
    expect(inst.leaderSteps).toHaveLength(0);
  });

  it("charted figures expose pre-fillable technique per dance", () => {
    const charted = chartedFiguresForDance("foxtrot").map((f) => f.id);
    expect(charted).toContain("foxtrot.feather_step");
    expect(charted).toContain("foxtrot.three_step");
  });
});
