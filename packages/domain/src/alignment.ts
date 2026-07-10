// Alignment derivation (PLAN §3.8 ⟳2026-07-10) — THE one home of the rotation math.
//
// The model: a step is a relative transform. Its `direction` is the relative
// translation of the moving foot; its `turn` is the relative rotation, canonically
// a SIGNED count of eighths (1 unit = 1/8 turn = 45°; positive = to the right /
// natural, negative = to the left / reverse — the `turn` vocabulary tokens are the
// stored serialization of exactly these integers). A figure stores a single start
// alignment (`FigureDoc.entryAlignment`); the absolute orientation after any step
// is derived: start ⊕ (sum of turns up to and including that step), on the room's
// 8-direction grid. WDSF charts print a step's turn on the row it is taken INTO
// ("x between N-1 and N" on row N — the convention the chart seed records), so
// alignment(N) = alignment(N-1) + turn(N).
//
// DELIBERATE TRADEOFF (owner-accepted 2026-07-10): a step carries ONE scalar turn.
// The ISTD/WDSF distinction between foot turn and body turn (CBM, "body completes
// turn", pointing positions) is NOT modelled — figures whose charted exit alignment
// depends on that split cannot be derived and keep a stored `exitAlignment` (the
// flagged set; see docs/seed/alignment-derivation-report.md). For every other
// charted figure the derivation reproduces the book's printed exit exactly
// (regression-pinned against __fixtures__/alignment-oracle.ts).
import type { Alignment } from "./doc-types";
import type { AuthoredStep } from "./figure-steps";

/**
 * The 8 room directions in wheel order: index = orientation, +1 = an eighth (45°)
 * to the right (natural). Facing LOD, an eighth right faces DW, then wall, …
 */
export const ROOM_DIRECTIONS = [
  "LOD",
  "DW",
  "wall",
  "DW_against",
  "ALOD",
  "DC_against",
  "centre",
  "DC",
] as const satisfies readonly Alignment["direction"][];

/** A body orientation as an integer mod 8 over {@link ROOM_DIRECTIONS}. */
export type RoomOrientation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const ORIENTATIONS: readonly RoomOrientation[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** Euclidean mod 8 → the orientation union (total for any finite integer). */
function mod8(n: number): RoomOrientation {
  const m = ORIENTATIONS[((Math.trunc(n) % 8) + 8) % 8];
  if (m === undefined) throw new Error(`orientation out of range: ${n}`);
  return m;
}

/**
 * The orientation an alignment token encodes: `facing X` = X's wheel index,
 * `backing X` = facing (X+4) mod 8. `pointing X` reads as X — the foot points X
 * while the body lags; which is exactly the foot-vs-body split the model does not
 * carry, so the qualifier is presentation and the foot's direction is the value.
 */
export function orientationOf(alignment: Alignment): RoomOrientation {
  const index = ROOM_DIRECTIONS.indexOf(alignment.direction);
  return mod8(alignment.qualifier === "backing" ? index + 4 : index);
}

// The `turn` vocabulary (vocabulary.ts) as signed eighths — tokens are fractions of
// a full turn with an L/R suffix, so the mapping is 1:1 and total over the enum.
const TURN_EIGHTHS: Readonly<Record<string, number>> = {
  none: 0,
  eighth_R: 1,
  eighth_L: -1,
  quarter_R: 2,
  quarter_L: -2,
  three_eighth_R: 3,
  three_eighth_L: -3,
  half_R: 4,
  half_L: -4,
  five_eighth_R: 5,
  five_eighth_L: -5,
  three_quarter_R: 6,
  three_quarter_L: -6,
  seven_eighth_R: 7,
  seven_eighth_L: -7,
  full_R: 8,
  full_L: -8,
};

/**
 * A `turn` vocabulary token as signed eighths (positive = right/natural), or
 * `undefined` for a value outside the enum (free text never reaches `turn`, but
 * reads stay forward-compatible: unknown in, no number out — never a guess).
 */
export function turnEighths(token: string): number | undefined {
  return TURN_EIGHTHS[token];
}

/**
 * Derive the absolute orientation AFTER each step from a start orientation and the
 * per-step turns in signed eighths: result[N] = start ⊕ Σ turns[0..N].
 * Pure and total — no side effects, inputs untouched, wraps mod 8 either way.
 */
export function deriveAlignments(
  start: RoomOrientation,
  turnsEighths: readonly number[],
): RoomOrientation[] {
  let cursor: RoomOrientation = start;
  return turnsEighths.map((turn) => {
    cursor = mod8(cursor + turn);
    return cursor;
  });
}

/**
 * Derive a figure's exit alignment token from its entry alignment and authored
 * steps, from the leader's perspective (the perspective the charts use): the
 * orientation is entry ⊕ Σ leader turns; the token is presented as `backing` when
 * the leader's last charted step travels `back`, else `facing`. That presentation
 * default reproduces the book's printed exit for every derivable charted figure
 * (pinned by alignment.test.ts against the frozen oracle); a figure it cannot
 * reproduce — `pointing` endings, promenade exits, heel-turn finishes charted as
 * backing off a closing step — keeps a stored exitAlignment instead.
 */
export function deriveExitAlignment(entry: Alignment, steps: readonly AuthoredStep[]): Alignment {
  let turns = 0;
  let lastDirection: string | undefined;
  for (const step of steps) {
    const leader = step.leader;
    if (!leader) continue; // a count the follower dances alone
    turns += (leader.turn !== undefined ? turnEighths(leader.turn) : 0) ?? 0;
    lastDirection = leader.direction;
  }
  const orientation = mod8(orientationOf(entry) + turns);
  if (lastDirection === "back") {
    const direction = ROOM_DIRECTIONS[mod8(orientation + 4)];
    return { qualifier: "backing", direction };
  }
  return { qualifier: "facing", direction: ROOM_DIRECTIONS[orientation] };
}
