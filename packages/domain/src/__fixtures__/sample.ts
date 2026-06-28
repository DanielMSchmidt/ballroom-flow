// ─────────────────────────────────────────────────────────────────────────
// The reusable read-only SAMPLE routine + a small shared figure library
// (PLAN.md §10.3: "a read-only sample routine + a small shared figure library
// (incl. a variant) defined once and reused").
//
// This is the canonical fixture every layer leans on:
//   • domain  — overlay/fork/figureType-resolution inputs;
//   • worker  — seedDb(...) projects these into D1 + seeded Automerge docs;
//   • E2E      — start-from-template / sample-routine journeys (US-045) mirror it.
//
// It deliberately includes a cross-dance figure family (Feather in Foxtrot AND
// Waltz, same `figureType`), a global figure, and an account VARIANT of a
// global figure — the minimum to exercise inheritance (US-006), copy-on-write
// (US-008), and figureType note resolution across dances (US-011/040/041).
//
// Frozen so a test can never mutate the shared fixture (each test should clone
// via the factories if it needs to mutate). Treat as READ-ONLY.
// ─────────────────────────────────────────────────────────────────────────
import {
  makeAttribute,
  makeFigureDoc,
  makeOverlay,
  makePlacement,
  makeRoutineDoc,
  makeSection,
} from "./factories";
import type { FigureDoc, RoutineDoc } from "./types";

// Stable owner ids used across layers (a "coach" + a "student" co-membership).
export const SAMPLE_COACH = "user_coach";
export const SAMPLE_STUDENT = "user_student";
export const SAMPLE_STRANGER = "user_stranger";

// ── Global library figures ────────────────────────────────────────────────
// Feather exists in TWO dances with different steps but ONE figureType family.
export const FEATHER_FOXTROT: Readonly<FigureDoc> = Object.freeze(
  makeFigureDoc({
    id: "fig_feather_foxtrot",
    figureType: "feather",
    dance: "foxtrot",
    name: "Feather",
    attributes: [
      makeAttribute({ id: "a_ff_1", kind: "footwork", count: 1, value: "HT" }),
      makeAttribute({ id: "a_ff_2", kind: "footwork", count: 2, value: "T" }),
      makeAttribute({ id: "a_ff_3", kind: "footwork", count: 3, value: "TH" }),
    ],
  }),
);

export const FEATHER_WALTZ: Readonly<FigureDoc> = Object.freeze(
  makeFigureDoc({
    id: "fig_feather_waltz",
    figureType: "feather",
    dance: "waltz",
    name: "Feather (Waltz)",
    attributes: [
      makeAttribute({ id: "a_fw_1", kind: "footwork", count: 1, value: "HT" }),
      makeAttribute({ id: "a_fw_2", kind: "rise", count: 1, value: "commence" }),
    ],
  }),
);

export const THREE_STEP_FOXTROT: Readonly<FigureDoc> = Object.freeze(
  makeFigureDoc({
    id: "fig_threestep_foxtrot",
    figureType: "three_step",
    dance: "foxtrot",
    name: "Three Step",
    attributes: [
      makeAttribute({ id: "a_ts_1", kind: "footwork", count: 1, value: "HT" }),
      makeAttribute({ id: "a_ts_2", kind: "footwork", count: 2, value: "T" }),
    ],
  }),
);

// ── Account variant ─────────────────────────────────────────────────────
// SAMPLE_STUDENT's variant of the global Foxtrot Feather: overrides count-2's
// value, drops count-3, adds a sway. Inherits figureType `feather` + dance
// `foxtrot` from the base (US-006/US-011).
export const STUDENT_FEATHER_VARIANT: Readonly<FigureDoc> = Object.freeze(
  makeFigureDoc({
    id: "fig_feather_variant_student",
    scope: "account",
    ownerId: SAMPLE_STUDENT,
    figureType: "feather",
    dance: "foxtrot",
    name: "My Feather",
    source: "custom",
    attributes: [],
    baseFigureRef: FEATHER_FOXTROT.id,
    overlay: makeOverlay({
      overrides: { a_ff_2: "TH" },
      tombstones: ["a_ff_3"],
      additions: [makeAttribute({ id: "a_var_sway", kind: "sway", count: 2, value: "to_L" })],
      rename: "My Feather",
    }),
  }),
);

/** The whole shared library as a lookup, keyed by figure id. */
export const SAMPLE_FIGURE_LIBRARY: Readonly<Record<string, Readonly<FigureDoc>>> = Object.freeze({
  [FEATHER_FOXTROT.id]: FEATHER_FOXTROT,
  [FEATHER_WALTZ.id]: FEATHER_WALTZ,
  [THREE_STEP_FOXTROT.id]: THREE_STEP_FOXTROT,
  [STUDENT_FEATHER_VARIANT.id]: STUDENT_FEATHER_VARIANT,
});

// ── The sample routine (read-only) ────────────────────────────────────────
// A Foxtrot routine owned by the coach, shared with the student, that
// references the global Feather + Three Step. Two sections.
export const SAMPLE_ROUTINE: Readonly<RoutineDoc> = Object.freeze(
  makeRoutineDoc({
    id: "rt_sample",
    title: "Sample Foxtrot",
    dance: "foxtrot",
    ownerId: SAMPLE_COACH,
    templateOf: "rt_sample", // the sample doubles as a start-from-template source
    sections: [
      makeSection({
        id: "sec_intro",
        name: "Intro",
        placements: [
          makePlacement(FEATHER_FOXTROT.id, { id: "plc_1" }),
          makePlacement(THREE_STEP_FOXTROT.id, { id: "plc_2" }),
        ],
      }),
      makeSection({
        id: "sec_body",
        name: "Body",
        placements: [makePlacement(FEATHER_FOXTROT.id, { id: "plc_3" })],
      }),
    ],
  }),
);

/** A second routine in a DIFFERENT dance referencing the Waltz Feather — used
 *  to prove an `all`-dances figureType note surfaces in BOTH dances (US-040). */
export const SAMPLE_WALTZ_ROUTINE: Readonly<RoutineDoc> = Object.freeze(
  makeRoutineDoc({
    id: "rt_sample_waltz",
    title: "Sample Waltz",
    dance: "waltz",
    ownerId: SAMPLE_COACH,
    sections: [
      makeSection({
        id: "sec_w_intro",
        name: "Intro",
        placements: [makePlacement(FEATHER_WALTZ.id, { id: "plc_w_1" })],
      }),
    ],
  }),
);
