// Alignment derivation (PLAN §3.8 ⟳2026-07-10) — absolute alignment is DERIVED, not stored.
//
// The model: a step is a relative transform (direction = translation, turn = rotation in
// signed eighths); a figure stores only its entry (start) alignment. The absolute
// orientation after step N is entry ⊕ Σ turn(1..N) on the 8-direction room grid
// (WDSF charts print a step's turn on the row it is taken INTO, so
// alignment(N) = alignment(N-1) + turn(N) — the convention recorded in the seed meta).
//
// Oracle: the book-verified exits frozen in __fixtures__/alignment-oracle.ts (captured
// from the seed BEFORE the redundant exits were dropped). Every figure whose seed no
// longer stores an exit must DERIVE exactly the exit the book printed; every figure that
// still stores one must be a genuine non-derivable case (the flag stays honest). The
// non-derivable set — ISTD/WDSF splitting foot turn from body turn (CBM), turns charted
// on a preceding figure's row, `pointing`/promenade endings — is catalogued in
// docs/seed/alignment-derivation-report.md. Deliberate tradeoff (PLAN §3.8): one scalar
// turn per step; the foot-vs-body turn split is NOT modelled.
import { describe, expect, it } from "vitest";
import { ALIGNMENT_ORACLE } from "./__fixtures__/alignment-oracle";
import {
  deriveAlignments,
  deriveExitAlignment,
  orientationOf,
  ROOM_DIRECTIONS,
  turnEighths,
} from "./alignment";
import { isDanceId } from "./dances";
import type { Alignment } from "./doc-types";
import { GENERATED_FIGURE_ALIGNMENTS } from "./figure-charts.generated";
import { authoredAlignment, FIGURE_STEPS } from "./figure-steps";
import { ATTRIBUTE_REGISTRY } from "./vocabulary";

describe("room orientation encoding (integer mod 8)", () => {
  it("orders the 8 room directions so +1 is an eighth to the right (natural)", () => {
    // Facing LOD, an eighth to the right faces DW, then wall, … — the standard
    // alignment wheel. Index = orientation; the array is the single token order.
    expect(ROOM_DIRECTIONS).toEqual([
      "LOD",
      "DW",
      "wall",
      "DW_against",
      "ALOD",
      "DC_against",
      "centre",
      "DC",
    ]);
  });

  it("maps facing X to X's index and backing X to (X+4) mod 8", () => {
    expect(orientationOf({ qualifier: "facing", direction: "LOD" })).toBe(0);
    expect(orientationOf({ qualifier: "facing", direction: "DC" })).toBe(7);
    expect(orientationOf({ qualifier: "backing", direction: "LOD" })).toBe(4);
    expect(orientationOf({ qualifier: "backing", direction: "DC" })).toBe(3);
    expect(orientationOf({ qualifier: "backing", direction: "DW_against" })).toBe(7);
  });

  it("treats `pointing X` as orientation X (the foot's direction; the body split is presentation)", () => {
    expect(orientationOf({ qualifier: "pointing", direction: "DW" })).toBe(1);
    expect(orientationOf({ qualifier: "pointing", direction: "centre" })).toBe(6);
  });
});

describe("turnEighths — the turn vocabulary as signed eighths", () => {
  it("covers exactly the `turn` registry enum and nothing else", () => {
    for (const token of ATTRIBUTE_REGISTRY.turn.values ?? []) {
      expect(turnEighths(token), `token ${token}`).toBeTypeOf("number");
    }
    expect(turnEighths("half")).toBeUndefined();
    expect(turnEighths("Continue")).toBeUndefined();
    expect(turnEighths("")).toBeUndefined();
  });

  it("encodes 1 unit = 1/8 turn, positive to the right (natural), negative to the left", () => {
    expect(turnEighths("none")).toBe(0);
    expect(turnEighths("eighth_R")).toBe(1);
    expect(turnEighths("eighth_L")).toBe(-1);
    expect(turnEighths("quarter_L")).toBe(-2);
    expect(turnEighths("three_eighth_R")).toBe(3);
    expect(turnEighths("half_L")).toBe(-4);
    expect(turnEighths("five_eighth_R")).toBe(5);
    expect(turnEighths("three_quarter_L")).toBe(-6);
    expect(turnEighths("seven_eighth_R")).toBe(7);
    expect(turnEighths("full_L")).toBe(-8);
    expect(turnEighths("full_R")).toBe(8);
  });
});

describe("deriveAlignments — the one home of the rotation math", () => {
  it("returns the cumulative orientation after each step", () => {
    // alignment(N) = alignment(N-1) + turn(N): the turn is taken INTO the step.
    expect(deriveAlignments(0, [1, 1, 2])).toEqual([1, 2, 4]);
    expect(deriveAlignments(3, [0, 0])).toEqual([3, 3]);
  });

  it("wraps mod 8 in both directions, including whole turns", () => {
    expect(deriveAlignments(7, [2])).toEqual([1]);
    expect(deriveAlignments(0, [-1])).toEqual([7]);
    expect(deriveAlignments(1, [8])).toEqual([1]); // a full natural turn lands where it started
    expect(deriveAlignments(0, [-16])).toEqual([0]); // two full reverse turns (VW fleckerl scale)
    expect(deriveAlignments(2, [-3, -3, -3])).toEqual([7, 4, 1]);
  });

  it("is pure: empty input → empty output, and inputs are never mutated", () => {
    expect(deriveAlignments(5, [])).toEqual([]);
    const turns = [1, -2, 3];
    deriveAlignments(0, turns);
    expect(turns).toEqual([1, -2, 3]);
  });
});

describe("deriveExitAlignment — presentation of the derived exit", () => {
  it("derives a constant figure's exit equal to its entry", () => {
    const entry: Alignment = { qualifier: "facing", direction: "DC" };
    const steps = [
      { leader: { direction: "forward", footwork: "HT" } },
      { leader: { direction: "forward", footwork: "HT" } },
      { leader: { direction: "close", footwork: "TH" } },
    ];
    expect(deriveExitAlignment(entry, steps)).toEqual(entry);
  });

  it("sums the LEADER's turns (alignments are charted from the leader's perspective)", () => {
    const entry: Alignment = { qualifier: "facing", direction: "LOD" };
    const steps = [
      { leader: { direction: "forward", footwork: "HT", turn: "quarter_R" } },
      {
        leader: { direction: "side", footwork: "T", turn: "eighth_R" },
        follower: { direction: "side", footwork: "T", turn: "half_L" },
      },
    ];
    expect(deriveExitAlignment(entry, steps)).toEqual({
      qualifier: "facing",
      direction: "DW_against",
    });
  });

  it("presents the exit as `backing` when the leader's last charted step travels back", () => {
    const entry: Alignment = { qualifier: "facing", direction: "DW" };
    const steps = [
      { leader: { direction: "forward", footwork: "HT", turn: "quarter_R" } },
      { leader: { direction: "back", footwork: "TH", turn: "eighth_R" } },
    ];
    // Orientation: DW(1) + 3 = ALOD(4); presented as backing (4+4)=LOD.
    expect(deriveExitAlignment(entry, steps)).toEqual({ qualifier: "backing", direction: "LOD" });
  });

  it("takes the last direction from the last step the leader actually dances (role-asymmetric charts)", () => {
    const entry: Alignment = { qualifier: "facing", direction: "LOD" };
    const steps = [
      { leader: { direction: "back", footwork: "TH" } },
      { follower: { direction: "forward", footwork: "HT" } }, // a count the leader does not dance
    ];
    expect(deriveExitAlignment(entry, steps)).toEqual({ qualifier: "backing", direction: "ALOD" });
  });
});

describe("seed oracle — derivation reproduces the book-verified exits", () => {
  // The oracle rows whose figure is still in the catalog. A figure removed from the
  // charts (no-fabrication prunes happen) simply drops out of the assertion set.
  const rows = ALIGNMENT_ORACLE.filter((r) => FIGURE_STEPS[r.key] !== undefined);

  it("still covers the charted catalog (the oracle didn't rot away)", () => {
    expect(rows.length).toBeGreaterThan(200);
  });

  it("never dropped or changed a stored ENTRY alignment (the figure's start_alignment)", () => {
    for (const row of rows) {
      const stored = GENERATED_FIGURE_ALIGNMENTS[row.key];
      expect(stored?.entry, `${row.key} entry`).toEqual(row.entry);
    }
  });

  it("derives the book's exact exit for every figure whose stored exit was dropped", () => {
    let derivable = 0;
    for (const row of rows) {
      const stored = GENERATED_FIGURE_ALIGNMENTS[row.key];
      if (stored?.exit) continue; // still stored — the flagged, non-derivable set
      derivable++;
      const steps = FIGURE_STEPS[row.key];
      expect(steps, `${row.key} steps`).toBeDefined();
      if (!steps || !stored?.entry) continue;
      expect(deriveExitAlignment(stored.entry, steps), `${row.key} derived exit`).toEqual(row.exit);
    }
    // The 2026-07-10 migration dropped 111 redundant exits; the set only grows as
    // charts are refined. Guards against the migration silently not applying.
    expect(derivable).toBeGreaterThanOrEqual(111);
  });

  it("keeps the non-derivable flag honest: a stored exit is one derivation does NOT reproduce", () => {
    // If derivation reproduces a stored exit exactly, that exit is redundant and must be
    // dropped from the seed (the figure is round-trippable). Storing it anyway would
    // silently fork the source of truth the refactor establishes.
    for (const [key, stored] of Object.entries(GENERATED_FIGURE_ALIGNMENTS)) {
      if (!stored.entry || !stored.exit) continue;
      const steps = FIGURE_STEPS[key];
      if (!steps) continue;
      expect(
        deriveExitAlignment(stored.entry, steps),
        `${key}: stored exit is derivable — drop it from the seed (see alignment-derivation-report.md)`,
      ).not.toEqual(stored.exit);
    }
  });

  it("authoredAlignment reproduces the book's exit for EVERY charted figure (stored or derived)", () => {
    // The seam every consumer (library catalog, global-figure seeder, web fallback)
    // reads: stored exit for flagged figures, derived exit otherwise — always the
    // book's value.
    for (const row of rows) {
      const [dance, figureType] = row.key.split(":");
      if (!dance || !figureType || !isDanceId(dance)) continue;
      const align = authoredAlignment(dance, figureType);
      expect(align?.entry, `${row.key} entry`).toEqual(row.entry);
      expect(align?.exit, `${row.key} exit`).toEqual(row.exit);
    }
  });
});
