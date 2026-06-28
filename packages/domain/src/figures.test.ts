import { describe, expect, it } from "vitest";
import {
  getLibraryFigure,
  instantiateFigure,
  LIBRARY_FIGURES,
  libraryFiguresForDance,
} from "./figures";
import { getSlot } from "./vocabulary";

describe("library data quality", () => {
  it("ships at least one figure", () => {
    expect(LIBRARY_FIGURES.length).toBeGreaterThan(0);
  });

  it("every figure has both leader and follower charts with steps", () => {
    for (const fig of LIBRARY_FIGURES) {
      expect(fig.leaderSteps.length, `${fig.id} leader`).toBeGreaterThan(0);
      expect(fig.followerSteps.length, `${fig.id} follower`).toBeGreaterThan(0);
    }
  });

  it("every step of every figure carries correct footwork (the owner's data bar)", () => {
    const footValues = new Set(getSlot("foot")?.values.map((v) => v.value));
    for (const fig of LIBRARY_FIGURES) {
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

  it("ids are unique", () => {
    const ids = LIBRARY_FIGURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
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

  it("waltz has the expected catalog figures", () => {
    const ids = libraryFiguresForDance("waltz").map((f) => f.id);
    expect(ids).toContain("waltz.natural_turn");
    expect(ids).toContain("waltz.reverse_turn");
  });
});
