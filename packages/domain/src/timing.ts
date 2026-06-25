// US-004 — Float-count timing (PLAN §2.5, §9 1.4, Q-D3).
//
// Attribute counts are floats relative to a figure's start. These helpers render
// them in conventional ballroom notation and locate them within the dance's
// counted phrase. Phrasing constants come from DANCES (US-002) — never re-derived
// here — so timing stays consistent with the one dance source of truth.
//
// Count fractions (Q-D3, the conventional "1 e & a 2" count):
//   .25 → "e", .5 → "&", .75 → "a"
// with an `i`-infix for 1/8-note subdivisions: .125 → "ia", .375 → "ai".
// (An earlier draft swapped e/a; these are the corrected mappings.)
import { DANCES, type DanceId } from "./dances";

// Fractional-part → suffix, on the 1/8 grid. Keyed by the fraction rounded to
// the nearest 1/8 so float input (e.g. 0.2500001) still resolves cleanly. Only
// the spec'd fractions carry a label; .625/.875 are intentionally left to the
// fallback (the plan/Q-D3 commit to these five only).
const FRACTION_LABELS: Record<string, string> = {
  "0.125": "ia",
  "0.25": "e",
  "0.375": "ai",
  "0.5": "&",
  "0.75": "a",
};

const EIGHTH = 0.125;

/**
 * Render a float count as a conventional ballroom label, e.g. 3.25 → "3e",
 * 3 → "3". The whole part is the beat; the fraction is the sub-beat suffix.
 * Unrecognized fractions (outside the spec'd 1/8 grid) fall back to the whole
 * beat plus the fraction (e.g. "3+0.2") so nothing is silently dropped.
 */
export function countLabel(count: number): string {
  const whole = Math.floor(count);
  const fraction = count - whole;
  if (fraction === 0) return String(whole);
  // Snap to the 1/8 grid so float noise maps to the intended suffix.
  const snapped = Math.round(fraction / EIGHTH) * EIGHTH;
  const suffix = FRACTION_LABELS[String(snapped)];
  if (suffix) return `${whole}${suffix}`;
  // Off-grid / unspecified fraction: keep it visible rather than rounding away,
  // but round to 3 decimals so float noise (e.g. 0.20000000000000018) doesn't
  // leak into the label. Trim trailing zeros so the display stays compact.
  const trimmed = Number.parseFloat(fraction.toFixed(3));
  return `${whole}+${trimmed}`;
}

/**
 * True when `count` lands on the 1/8-note grid — i.e. its fractional part is a
 * multiple of 1/8 (the e/&/a/i subdivision grid). Counts are floats, so we snap
 * to the nearest 1/8 and check the residual is within float tolerance. This is
 * the "valid timing position" rule the strict write schema enforces (US-012):
 * a count must sit on a real sub-beat, but it may exceed `phraseBeats` (figures
 * span multiple phrases — see `countToPhrase`).
 */
export function isOnEighthGrid(count: number): boolean {
  const snapped = Math.round(count / EIGHTH) * EIGHTH;
  return Math.abs(count - snapped) < 1e-9;
}

/**
 * Locate a 1-indexed count within the dance's counted phrase. The phrase length
 * is the dance's `phraseBeats` (Waltz/Viennese 6, rest 8); counts beyond it wrap
 * to the next phrase. `phrase` is the 1-indexed phrase number, `countInPhrase`
 * the 1-indexed position within it. E.g. Waltz count 7 → { phrase: 2,
 * countInPhrase: 1 }.
 *
 * (The returned position counts in phrase-length cycles — what "modulo phrase"
 * in the AC specifies. The `phrase` field was renamed from `bar`, which was a
 * misnomer: it indexes phrases, not musical bars.)
 */
export function countToPhrase(
  count: number,
  dance: DanceId,
): { phrase: number; countInPhrase: number } {
  const { phraseBeats } = DANCES[dance];
  const beat = Math.floor(count); // whole-beat position; fractions stay within a beat
  const zeroBased = beat - 1;
  return {
    phrase: Math.floor(zeroBased / phraseBeats) + 1,
    countInPhrase: (((zeroBased % phraseBeats) + phraseBeats) % phraseBeats) + 1,
  };
}

/**
 * Compute how many phrases a figure spans, given the counts its attributes land
 * on. Derived from the largest count, so it honors the role's latest attribute
 * when called per role (the caller passes that role's counts). An empty figure
 * spans 1 phrase.
 */
export function barsForFigure(counts: number[], dance: DanceId): number {
  if (counts.length === 0) return 1;
  const maxCount = Math.max(...counts);
  return countToPhrase(maxCount, dance).phrase;
}
