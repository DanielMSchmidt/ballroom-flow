// Authored per-count technique content for the figures whose both-role footwork has been
// verified. The public WDSF/ISTD syllabus seed (library-data.ts) gives only timing +
// start/finish phrases, so `buildWdsfAttributes` otherwise emits a near-empty scaffold (no
// `direction` headline, blank middle steps). This module fills in the real per-count
// `direction` (the step headline) and `footwork` (the foot part, as the ISTD H/T/TH tokens
// the footwork vocabulary accepts as free-text) for both roles, so a figure added from the
// library arrives with its full timeline.
//
// Footwork follows standard ISTD technique: forward walks = Heel-Toe (HT); back walks =
// Toe-Heel (TH); a step taken "up" = Toe (T); the closing/lowering step = TH; the follower's
// heel turn = TH, HT, TH. Coverage grows as more figures are verified; un-listed figures keep
// the start/finish scaffold rather than carrying invented footwork.

import type { DanceId } from "./dances";

/**
 * One role's step content. `direction` (headline) + `footwork` are required; the
 * role-aware extras (`sway`, `turn`, `bodyActions`) are filled in when the source
 * gives them. All values are vocabulary tokens (see vocabulary.ts): direction is a
 * closed enum, footwork free-text (ISTD HT/T/TH/H/"heel pull"), sway to_L/to_R/none,
 * turn the turn enum (quarter_R…), bodyActions a list (e.g. ["CBM"]).
 */
export interface AuthoredFootwork {
  /** A value from the `direction` vocabulary (forward/back/side/behind/close/diagonal/in_place). */
  direction: string;
  /** Footwork token (ISTD HT/T/TH/H/"heel pull" form, accepted by the `footwork` kind). */
  footwork: string;
  /** Sway (`sway` vocab: to_L/to_R/none) — role-aware, set when known. */
  sway?: string;
  /** Turn (`turn` vocab: quarter_R…) — role-aware, set when known. */
  turn?: string;
  /** Body actions (`bodyActions` vocab, e.g. ["CBM"]) — role-aware, set when known. */
  bodyActions?: string[];
}

/**
 * One count's authored content. The per-role footwork plus the SHARED (non-role)
 * `rise` and `position` the couple dance together (vocabulary.ts marks both
 * non-roleAware). `rise` ∈ the rise enum (commence/continue/up/lowering/NFR…);
 * `position` ∈ the position enum (closed/promenade/wing/CBMP) — set only when the
 * source's position maps to one of those (e.g. "Outside Partner Position" has no
 * slot in our vocabulary, so it's left unset rather than written as an unknown).
 */
export interface AuthoredStep {
  leader: AuthoredFootwork;
  follower: AuthoredFootwork;
  /** Rise & fall for this count (`rise` vocab) — shared by the couple. */
  rise?: string;
  /** Dance position for this count (`position` vocab) — shared by the couple. */
  position?: string;
}

// Helpers to keep the tables readable. `s` is the direction+footwork-only form
// (back-compatible with the original charts); richer charts use object literals.
const s = (
  leaderDir: string,
  leaderFoot: string,
  followerDir: string,
  followerFoot: string,
): AuthoredStep => ({
  leader: { direction: leaderDir, footwork: leaderFoot },
  follower: { direction: followerDir, footwork: followerFoot },
});

// Closed-change pattern (3 steps): leader forward, follower back. Used by both changes —
// the feet differ but direction/footwork do not.
const CLOSED_CHANGE: readonly AuthoredStep[] = [
  s("forward", "HT", "back", "TH"),
  s("side", "T", "side", "T"),
  s("close", "TH", "close", "TH"),
];

// Natural/Reverse turn pattern (6 steps): leader turns forward→back, follower back→forward
// with a heel turn on counts 2–3. Direction/footwork are foot-agnostic, so the natural and
// reverse turns share this table.
const SWING_TURN: readonly AuthoredStep[] = [
  s("forward", "HT", "back", "TH"),
  s("side", "T", "close", "HT"), // follower heel turn
  s("close", "TH", "side", "TH"),
  s("back", "TH", "forward", "HT"),
  s("side", "T", "side", "T"),
  s("close", "TH", "close", "TH"),
];

/** Verified content keyed by `${dance}:${figureType}`. */
export const FIGURE_STEPS: Record<string, readonly AuthoredStep[]> = {
  "waltz:natural-turn": SWING_TURN,
  "waltz:reverse-turn": SWING_TURN,
  "waltz:closed-change-on-rf": CLOSED_CHANGE,
  "waltz:closed-change-on-lf": CLOSED_CHANGE,
  "foxtrot:feather-step": [
    s("forward", "HT", "back", "TH"),
    s("forward", "T", "back", "TH"),
    s("forward", "TH", "back", "T"),
  ],
  "foxtrot:three-step": [
    s("forward", "HT", "back", "TH"),
    s("forward", "HT", "back", "TH"),
    s("forward", "TH", "back", "T"),
  ],

  // Research-derived (leader corroborated; follower from the standard conventions). Worth a
  // check against the technique books, like the rest — kept here so the Bronze Waltz set is
  // more complete. The Whisk's third step crosses behind into PP (modeled as a side step).
  "waltz:whisk": [
    s("forward", "HT", "back", "TH"),
    s("side", "T", "side", "T"),
    s("side", "T", "side", "TH"),
  ],
  "waltz:outside-change": [
    s("back", "TH", "forward", "HT"),
    s("back", "T", "forward", "T"),
    s("side", "TH", "side", "TH"),
  ],
  // Chassé from PP — timing 1 2 & 3, so the close lands on the "&".
  "waltz:chasse-from-pp": [
    s("forward", "HT", "forward", "HT"),
    s("side", "T", "side", "T"),
    s("close", "T", "close", "T"),
    s("side", "TH", "side", "TH"),
  ],
};

/** Authored per-count steps for a figure, or `undefined` when none are verified yet. */
export function authoredSteps(
  dance: DanceId,
  figureType: string,
): readonly AuthoredStep[] | undefined {
  return FIGURE_STEPS[`${dance}:${figureType}`];
}
