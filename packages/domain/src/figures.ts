// @ballroom/domain — Figure model + the static library catalog (design §2.1, §2.3).
//
// The catalog is the full ISTD/WDSF Standard syllabus (names + grade, see catalog.ts). A
// *charted* figure ships TWO authoritative step charts (leader + follower) where every step
// carries its Footwork; adding it to a routine instantiates a pristine copy of that default,
// and whether it then reads as "custom" is DERIVED by diffing the instance against the
// default (custom.ts), never set at add-time. Figures whose verified technique isn't yet in
// hand are listed as un-charted entries (empty charts) so the catalogue is complete to pick
// from — footwork is never invented.
//
// Charted footwork follows ISTD / IDTA standard technique (Alex Moore; Guy Howard, *The
// Technique of Ballroom Dancing*), cross-checked against Dance Central charts.

import { catalogFigureId, STANDARD_CATALOG } from "./catalog";
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

/** ISTD/WDSF syllabus grade. */
export type FigureLevel = "bronze" | "silver" | "gold";

/**
 * A catalog figure: the default both-role charts a routine figure is instantiated from.
 *
 * The catalog covers the full ISTD/WDSF Standard syllabus by NAME + level (see catalog.ts).
 * A figure is *charted* when it carries verified both-role step charts (footwork on every
 * step) — those pre-fill in full when added. The remainder are listed so the catalogue is
 * complete to pick from, but their charts are empty pending verified technique (the detailed
 * per-step footwork lives in the copyrighted WDSF/ISTD technique books and is not openly
 * sourceable). `isCharted()` reports which is which; no chart is ever fabricated.
 */
export interface LibraryFigure {
  id: string;
  dance: DanceId;
  name: string;
  level?: FigureLevel;
  entryAlignment?: Alignment | null;
  exitAlignment?: Alignment | null;
  leaderSteps: Step[];
  followerSteps: Step[];
}

/** True when the figure has verified charts (so adding it pre-fills the technique). */
export function isCharted(figure: LibraryFigure): boolean {
  return figure.leaderSteps.length > 0 || figure.followerSteps.length > 0;
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

// --- charted figures ------------------------------------------------------------------
//
// Figures with verified both-role footwork. Footwork follows ISTD/IDTA standard technique:
// forward walks = Heel-Toe (HT); back walks = Toe-Heel (TH); the closing/lowering step of a
// figure = TH; a step taken "up" = Toe (T); the follower's heel turn = TH, HT, TH. The rest
// of the syllabus is listed by name in catalog.ts (see STANDARD_CATALOG) and merged into
// LIBRARY_FIGURES below as un-charted entries — never with invented footwork.

const CHARTED_FIGURES: readonly LibraryFigure[] = [
  {
    id: "waltz.natural_turn",
    dance: "waltz",
    name: "Natural Turn",
    level: "bronze",
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
    level: "bronze",
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
    level: "bronze",
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
    id: "waltz.closed_change_reverse_to_natural",
    dance: "waltz",
    name: "Closed Change (Reverse to Natural)",
    level: "bronze",
    entryAlignment: f("backing", "DW"),
    exitAlignment: f("facing", "DW"),
    // Mirror of the Natural-to-Reverse change (opposite feet, same footwork).
    leaderSteps: chart([
      ["LF forward", "HT", 1],
      ["RF to side", "T", 2],
      ["LF closes to RF", "TH", 3],
    ]),
    followerSteps: chart([
      ["RF back", "TH", 1],
      ["LF to side", "T", 2],
      ["RF closes to LF", "TH", 3],
    ]),
  },
  {
    id: "waltz.whisk",
    dance: "waltz",
    name: "Whisk",
    level: "bronze",
    entryAlignment: f("facing", "DW"),
    exitAlignment: f("facing", "DW"),
    leaderSteps: chart([
      ["LF forward", "HT", 1],
      ["RF to side and slightly forward", "T", 2],
      ["LF crosses behind RF in PP", "T", 3],
    ]),
    followerSteps: chart([
      ["RF back", "TH", 1],
      ["LF to side and slightly forward, turning to PP", "T", 2],
      ["RF crosses behind LF in PP", "TH", 3],
    ]),
  },
  {
    id: "waltz.closed_impetus",
    dance: "waltz",
    name: "Closed Impetus",
    level: "bronze",
    entryAlignment: f("backing", "LOD"),
    exitAlignment: f("facing", "DC_against"),
    // Leader makes the heel turn (TH, HT, TH); follower moves around in three walks.
    leaderSteps: chart([
      ["LF back", "TH", 1],
      ["RF closes to LF (heel turn)", "HT", 2],
      ["RF diagonally forward, having brushed to LF", "TH", 3],
    ]),
    followerSteps: chart([
      ["RF forward", "HT", 1],
      ["LF to side", "T", 2],
      ["RF forward, brushing to LF", "TH", 3],
    ]),
  },
  {
    id: "waltz.outside_change",
    dance: "waltz",
    name: "Outside Change",
    level: "bronze",
    entryAlignment: f("backing", "DC"),
    exitAlignment: f("facing", "DW"),
    leaderSteps: chart([
      ["LF back", "TH", 1],
      ["RF back", "T", 2],
      ["LF to side and slightly forward", "TH", 3],
    ]),
    followerSteps: chart([
      ["RF forward", "HT", 1],
      ["LF forward", "T", 2],
      ["RF to side and slightly forward, outside partner", "TH", 3],
    ]),
  },
  {
    id: "waltz.chasse_from_promenade_position",
    dance: "waltz",
    name: "Chasse from Promenade Position",
    level: "bronze",
    entryAlignment: f("facing", "DW"),
    exitAlignment: f("facing", "DW"),
    // Chassé timing 1 2 & 3 — the third step is the quick close on the "&".
    leaderSteps: [
      { action: "RF forward and across in PP and CBMP", foot: "HT", timing: { beat: 1 } },
      { action: "LF to side", foot: "T", timing: { beat: 2 } },
      { action: "RF closes to LF", foot: "T", timing: { beat: 2, sub: "&" } },
      { action: "LF to side and slightly forward", foot: "TH", timing: { beat: 3 } },
    ],
    followerSteps: [
      { action: "LF forward and across in PP and CBMP", foot: "HT", timing: { beat: 1 } },
      { action: "RF to side", foot: "T", timing: { beat: 2 } },
      { action: "LF closes to RF", foot: "T", timing: { beat: 2, sub: "&" } },
      { action: "RF to side and slightly forward", foot: "TH", timing: { beat: 3 } },
    ],
  },
  {
    id: "foxtrot.feather_step",
    dance: "foxtrot",
    name: "Feather Step",
    level: "bronze",
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
    level: "bronze",
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

// --- the full catalogue ---------------------------------------------------------------
//
// Every charted figure above, plus the rest of the ISTD/WDSF Standard syllabus by name
// (catalog.ts) as un-charted stubs (empty charts). A stub is skipped when a charted figure
// already owns its id, so the charted technique always wins.

function stubFigure(dance: DanceId, name: string, level: FigureLevel): LibraryFigure {
  return {
    id: catalogFigureId(dance, name),
    dance,
    name,
    level,
    leaderSteps: [],
    followerSteps: [],
  };
}

// Dedup by catalogue id so a charted figure always suppresses its name-matched stub, even
// when the charted figure carries a shorter hand-written id (e.g. waltz.closed_change).
const CHARTED_CATALOG_IDS = new Set(
  CHARTED_FIGURES.map((fig) => catalogFigureId(fig.dance, fig.name)),
);

const CATALOG_STUBS: LibraryFigure[] = STANDARD_CATALOG.flatMap(([dance, name, level]) => {
  const stub = stubFigure(dance, name, level);
  return CHARTED_CATALOG_IDS.has(stub.id) ? [] : [stub];
});

/** The complete Standard catalogue: verified charted figures first, then un-charted stubs. */
export const LIBRARY_FIGURES: readonly LibraryFigure[] = [...CHARTED_FIGURES, ...CATALOG_STUBS];

const LIBRARY_BY_ID = new Map<string, LibraryFigure>(LIBRARY_FIGURES.map((fig) => [fig.id, fig]));

export function getLibraryFigure(id: string): LibraryFigure | undefined {
  return LIBRARY_BY_ID.get(id);
}

export function libraryFiguresForDance(dance: DanceId): LibraryFigure[] {
  return LIBRARY_FIGURES.filter((fig) => fig.dance === dance);
}

/** Charted figures for a dance — the ones that pre-fill their technique when added. */
export function chartedFiguresForDance(dance: DanceId): LibraryFigure[] {
  return libraryFiguresForDance(dance).filter(isCharted);
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
