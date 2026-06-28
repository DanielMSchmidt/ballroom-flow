// @ballroom/domain — Figure model + the static library catalog (design §2.1, §2.3).
//
// A library figure ships TWO authoritative step charts (leader + follower) and every step
// carries at least its Footwork — the one technique attribute the owner requires to be
// present on every catalog figure. When a figure is added to a routine it is *instantiated*
// as a pristine copy of the library default; whether it then reads as "custom" is DERIVED by
// diffing the instance against this default (see custom.ts), never set at add-time.
//
// Footwork values follow ISTD / IDTA standard technique (Alex Moore; Guy Howard, *The
// Technique of Ballroom Dancing*), cross-checked against Dance Central charts. They are the
// catalog default; the custom-attribute mechanism exists precisely so a couple can correct
// or extend them per routine without mutating the shared catalog.

import type { DanceId } from "./vocabulary";

export type { DanceId, StepRole } from "./vocabulary";

export type AlignmentQualifier = "facing" | "backing" | "pointing";
export type AlignmentDirection =
  | "LOD"
  | "ALOD"
  | "wall"
  | "centre"
  | "DW"
  | "DC"
  | "DW_against"
  | "DC_against";

export interface Alignment {
  qualifier: AlignmentQualifier;
  direction: AlignmentDirection;
}

/** Meter-based timing (design §2.1): `beat` is the position within the two-bar phrase. */
export interface Timing {
  beat: number;
  sub?: "e" | "&" | "a";
  /** Beat-value the step occupies, e.g. "S" (2 beats) / "Q" (1) in S/Q dances. */
  value?: string;
}

/**
 * One row of a technique chart. The core slots (design §3) are nullable typed fields; a
 * `null`/absent slot means "not configured" — which is what distinguishes *changing* a
 * configured attribute (→ custom) from *adding* a new one (→ implicit fork) in custom.ts.
 */
export interface Step {
  action: string;
  timing: Timing;
  rise?: string | null;
  body?: string | null;
  bodyActions?: string[];
  foot?: string | null;
  sway?: string | null;
  turn?: string | null;
}

/** A catalog figure: the default both-role charts a routine figure is instantiated from. */
export interface LibraryFigure {
  id: string;
  dance: DanceId;
  name: string;
  entryAlignment?: Alignment | null;
  exitAlignment?: Alignment | null;
  leaderSteps: Step[];
  followerSteps: Step[];
}

/** A figure as it lives inside a routine. `libraryFigureId === null` = composed from scratch. */
export interface FigureInstance {
  id: string;
  libraryFigureId: string | null;
  name: string;
  entryAlignment?: Alignment | null;
  exitAlignment?: Alignment | null;
  leaderSteps: Step[];
  followerSteps: Step[];
}

// --- chart builders -------------------------------------------------------------------

const f = (qualifier: AlignmentQualifier, direction: AlignmentDirection): Alignment => ({
  qualifier,
  direction,
});

/** Build a chart from `[action, footwork, beat]` tuples — footwork is mandatory per step. */
function chart(rows: ReadonlyArray<readonly [string, string, number]>): Step[] {
  return rows.map(([action, foot, beat]) => ({ action, foot, timing: { beat } }));
}

// --- the v1 library -------------------------------------------------------------------
//
// Curated for fully-correct, both-role footwork rather than breadth. Tango is intentionally
// absent: its walks are danced "foot flat", which the v1 Footwork vocabulary (§3.3) does not
// yet model, so seeding it would violate the "every step has correct footwork" guarantee.
// Forward walks = Heel-Toe (HT); back walks = Toe-Heel (TH); the closing/lowering step of a
// figure = TH; a step taken "up" = Toe (T); the follower's heel turn = TH, HT, TH.

export const LIBRARY_FIGURES: readonly LibraryFigure[] = [
  {
    id: "waltz.natural_turn",
    dance: "waltz",
    name: "Natural Turn",
    entryAlignment: f("facing", "DW"),
    exitAlignment: f("facing", "DW"),
    leaderSteps: chart([
      ["RF forward", "HT", 1],
      ["LF to side", "T", 2],
      ["RF closes to LF", "TH", 3],
      ["LF back", "TH", 4],
      ["RF to side", "T", 5],
      ["LF closes to RF", "TH", 6],
    ]),
    followerSteps: chart([
      ["LF back", "TH", 1],
      ["RF closes to LF (heel turn)", "HT", 2],
      ["LF to side and forward", "TH", 3],
      ["RF forward", "HT", 4],
      ["LF to side", "T", 5],
      ["RF closes to LF", "TH", 6],
    ]),
  },
  {
    id: "waltz.reverse_turn",
    dance: "waltz",
    name: "Reverse Turn",
    entryAlignment: f("facing", "DC"),
    exitAlignment: f("facing", "DC"),
    leaderSteps: chart([
      ["LF forward", "HT", 1],
      ["RF to side", "T", 2],
      ["LF closes to RF", "TH", 3],
      ["RF back", "TH", 4],
      ["LF to side", "T", 5],
      ["RF closes to LF", "TH", 6],
    ]),
    followerSteps: chart([
      ["RF back", "TH", 1],
      ["LF closes to RF (heel turn)", "HT", 2],
      ["RF to side and forward", "TH", 3],
      ["LF forward", "HT", 4],
      ["RF to side", "T", 5],
      ["LF closes to RF", "TH", 6],
    ]),
  },
  {
    id: "waltz.closed_change",
    dance: "waltz",
    name: "Closed Change (Natural to Reverse)",
    entryAlignment: f("backing", "DC"),
    exitAlignment: f("facing", "DC"),
    leaderSteps: chart([
      ["RF forward", "HT", 1],
      ["LF to side", "T", 2],
      ["RF closes to LF", "TH", 3],
    ]),
    followerSteps: chart([
      ["LF back", "TH", 1],
      ["RF to side", "T", 2],
      ["LF closes to RF", "TH", 3],
    ]),
  },
  {
    id: "foxtrot.feather_step",
    dance: "foxtrot",
    name: "Feather Step",
    entryAlignment: f("facing", "DC"),
    exitAlignment: f("facing", "DC"),
    leaderSteps: [
      { action: "RF forward", foot: "HT", timing: { beat: 1, value: "S" } },
      { action: "LF forward", foot: "T", timing: { beat: 3, value: "Q" } },
      {
        action: "RF forward in CBMP, outside partner",
        foot: "TH",
        timing: { beat: 4, value: "Q" },
      },
    ],
    followerSteps: [
      { action: "LF back", foot: "TH", timing: { beat: 1, value: "S" } },
      { action: "RF back", foot: "TH", timing: { beat: 3, value: "Q" } },
      { action: "LF back", foot: "T", timing: { beat: 4, value: "Q" } },
    ],
  },
  {
    id: "foxtrot.three_step",
    dance: "foxtrot",
    name: "Three Step",
    entryAlignment: f("facing", "DC"),
    exitAlignment: f("facing", "DC"),
    leaderSteps: [
      { action: "LF forward", foot: "H", timing: { beat: 1, value: "S" } },
      { action: "RF forward", foot: "HT", timing: { beat: 3, value: "Q" } },
      { action: "LF forward", foot: "TH", timing: { beat: 4, value: "Q" } },
    ],
    followerSteps: [
      { action: "RF back", foot: "TH", timing: { beat: 1, value: "S" } },
      { action: "LF back", foot: "TH", timing: { beat: 3, value: "Q" } },
      { action: "RF back", foot: "T", timing: { beat: 4, value: "Q" } },
    ],
  },
] as const;

const LIBRARY_BY_ID = new Map<string, LibraryFigure>(LIBRARY_FIGURES.map((fig) => [fig.id, fig]));

export function getLibraryFigure(id: string): LibraryFigure | undefined {
  return LIBRARY_BY_ID.get(id);
}

export function libraryFiguresForDance(dance: DanceId): LibraryFigure[] {
  return LIBRARY_FIGURES.filter((fig) => fig.dance === dance);
}

function cloneStep(step: Step): Step {
  return {
    ...step,
    timing: { ...step.timing },
    bodyActions: step.bodyActions ? [...step.bodyActions] : undefined,
  };
}

function cloneAlignment(a: Alignment | null | undefined): Alignment | null | undefined {
  return a ? { ...a } : a;
}

/**
 * Add a library figure to a routine. The result is a *pristine* deep copy of the catalog
 * default — `deriveFigureCustomState` reports it as not custom until something diverges.
 */
export function instantiateFigure(library: LibraryFigure, id: string): FigureInstance {
  return {
    id,
    libraryFigureId: library.id,
    name: library.name,
    entryAlignment: cloneAlignment(library.entryAlignment),
    exitAlignment: cloneAlignment(library.exitAlignment),
    leaderSteps: library.leaderSteps.map(cloneStep),
    followerSteps: library.followerSteps.map(cloneStep),
  };
}
