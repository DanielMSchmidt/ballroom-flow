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

import { deriveExitAlignment } from "./alignment";
import type { DanceId } from "./dances";
import type { Alignment } from "./doc-types";
import { GENERATED_FIGURE_ALIGNMENTS, GENERATED_FIGURE_STEPS } from "./figure-charts.generated";

/**
 * One role's step content. `direction` (headline) + `footwork` are required; the
 * role-aware extras (`sway`, `turn`, `bodyActions`) are filled in when the source
 * gives them. All values are vocabulary tokens (see vocabulary.ts): direction is a
 * closed enum, footwork the closed ISTD picklist (HT/TH/T/H/… plus the compound rolls
 * BH/THT/T/H/T/…), sway to_L/to_R/none, turn the turn enum (quarter_R…), bodyActions
 * a list (e.g. ["CBM"]).
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
 * `position` ∈ the position enum (closed/promenade/counter_promenade/outside_partner/
 * left_side/right_side/tandem/wing/CBMP) — set only when the source's position maps
 * to one of those, else left unset rather than written as an unknown.
 */
export interface AuthoredStep {
  /** Absent when this count is the other role's alone — the WDSF books chart
   *  role-asymmetric figures (e.g. the Double Reverse Spin's follower "&" step). */
  leader?: AuthoredFootwork;
  /** Absent when this count is the leader's alone. */
  follower?: AuthoredFootwork;
  /** Rise & fall for this count (`rise` vocab) — shared by the couple. */
  rise?: string;
  /** Dance position for this count (`position` vocab) — shared by the couple. */
  position?: string;
}

/**
 * Verified per-figure content keyed by `${dance}:${figureType}`. GENERATED from the
 * research bundle (real WDSF-first technique looked up per figure, one source per
 * figure recorded) — see figure-charts.generated.ts. A figure with no verified chart
 * is absent here and falls back to the start/finish scaffold in buildWdsfAttributes.
 */
export const FIGURE_STEPS: Record<string, readonly AuthoredStep[]> = GENERATED_FIGURE_STEPS;

/** Authored per-count steps for a figure, or `undefined` when none are verified yet. */
export function authoredSteps(
  dance: DanceId,
  figureType: string,
): readonly AuthoredStep[] | undefined {
  return FIGURE_STEPS[`${dance}:${figureType}`];
}

/**
 * Figure-level entry/exit alignment (per-figure, from the leader's perspective) for a
 * charted figure, or `undefined` when the source doesn't chart it.
 *
 * The ENTRY is the figure's stored start alignment. The EXIT is DERIVED —
 * entry ⊕ the leader's summed turns (alignment.ts) — except for the flagged
 * non-derivable figures (foot-vs-body turn splits, `pointing` endings; see
 * docs/seed/alignment-derivation-report.md), which keep a stored exit in the seed.
 * Either way the value returned here is the book's printed exit (alignment.test.ts
 * pins both paths against the frozen oracle).
 */
export function authoredAlignment(
  dance: DanceId,
  figureType: string,
): { entry?: Alignment; exit?: Alignment } | undefined {
  const key = `${dance}:${figureType}`;
  const stored = GENERATED_FIGURE_ALIGNMENTS[key];
  if (!stored) return undefined;
  if (stored.exit || !stored.entry) return stored;
  const steps = GENERATED_FIGURE_STEPS[key];
  if (!steps) return stored;
  return { entry: stored.entry, exit: deriveExitAlignment(stored.entry, steps) };
}
