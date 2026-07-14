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
 * Dance-aware {@link countLabel}: the whole-beat number is rendered MODULO the
 * dance's counted phrase ({@link countToPhrase}), so a Waltz never counts past
 * 6 — count 7 reads "1", 7.5 reads "1&" (the sub-beat suffix rides along
 * unchanged). Display-only, exactly like `numberRoutineBeats`: the underlying
 * float counts stay continuous; only the label wraps.
 */
export function phraseCountLabel(count: number, dance: DanceId): string {
  const whole = Math.floor(count);
  const { countInPhrase } = countToPhrase(count, dance);
  // Re-attach the original fraction to the wrapped beat number; countLabel
  // renders the suffix. (count - whole) preserves the fraction bit-exactly.
  return countLabel(countInPhrase + (count - whole));
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

/**
 * The sub-beat symbol for an OFF-beat count (2.5 → "&", 2.25 → "e", 2.75 → "a"),
 * or null for a whole beat. Unlike {@link countLabel} it drops the whole-beat
 * prefix — the continuous reading-view numbering (US-004a) renders an off-beat as
 * its symbol ALONE (it doesn't belong to a local beat there) and, crucially,
 * consumes no beat number.
 */
export function offBeatSymbol(count: number): string | null {
  const fraction = count - Math.floor(count);
  if (fraction === 0) return null;
  const snapped = Math.round(fraction / EIGHTH) * EIGHTH;
  return FRACTION_LABELS[String(snapped)] ?? `+${Number.parseFloat(fraction.toFixed(3))}`;
}

/**
 * Render a figure's steps as SLOW / QUICK rhythm tokens — the S/Q notation
 * dancers use for Tango, Foxtrot and Quickstep — instead of beat numbers, one
 * token per sorted distinct `count` (aligned 1:1 with `counts`).
 *
 * A whole-beat step's token comes from its DURATION, the gap to the next step
 * (or to `endCount` for the last step): **two beats = a Slow (`S`)**, **one beat
 * = a Quick (`Q`)** — and any longer hold reads as a Slow. An OFF-beat step keeps
 * its conventional sub-beat symbol (`&` = half a count, plus `e`/`a` and the
 * `i`-subdivisions `ia`/`ai`) "as usual" — so a syncopation like Q&Q still reads
 * `Q & Q`. This is the exact inverse of {@link parseWdsfTiming}'s S=2/Q=1/&=½
 * duration model, kept in step with it.
 *
 * `endCount` is the figure's start-relative end — `bars × beatsPerBar + 1`, the
 * boundary the last step runs to. Display-only; the float counts are untouched.
 */
export function slowQuickTokens(counts: number[], endCount: number): string[] {
  return counts.map((count, i) => {
    // An off-beat step keeps its sub-beat symbol (& / e / a / ia / ai).
    const symbol = offBeatSymbol(count);
    if (symbol !== null) return symbol;
    const next = counts[i + 1] ?? endCount;
    const duration = next - count;
    // Two beats or more is a Slow; anything shorter (a whole beat, or a beat
    // split by a following off-beat) is a Quick.
    return duration >= 2 ? "S" : "Q";
  });
}

/** One entry in a routine's ordered beat stream: a figure (its distinct sorted
 *  BLOCK-LOCAL counts — a portioned placement rebases its window so the first
 *  windowed beat is count 1 — plus its length in whole beats) or a break (its
 *  whole-beat duration). `beats` is the figure's authored length
 *  (`resolveFigureCounts`; a portion window: its `partBeatSpan`) — when absent,
 *  the block falls back to the last whole beat a step covers. */
export type RoutineBeatEntry =
  | { kind: "figure"; counts: number[]; beats?: number }
  | { kind: "break"; beats: number };

/** A numbered entry aligned 1:1 with the {@link RoutineBeatEntry} input. */
export type NumberedBeatEntry =
  | { kind: "figure"; tokens: string[] }
  | {
      kind: "break";
      beats: number;
      bars: number;
      startBeat: number;
      endBeat: number;
      span: string;
    };

/**
 * Number a routine's beats CONTINUOUSLY across the whole routine (US-004a).
 *
 * A single running whole-beat counter threads through every entry in order; the
 * displayed number wraps at the dance's phrase length (Waltz/Viennese 6, others
 * 8), so a figure starting a phrase reads "1" and one starting the second bar
 * reads "4" (Waltz) / "5" (4/4). Each entry advances the counter by its LENGTH
 * in beats — a figure's `beats` (falling back to the last whole beat a step
 * covers), a break's `beats` — never by how many steps it carries, so a held
 * Slow still occupies its beats and the next figure starts after them
 * (⟳2026-07-14; previously each whole-beat step advanced the counter by one,
 * mis-starting everything after a figure whose steps don't fill its length).
 * Within a figure a step is numbered by its own whole-beat offset from the
 * block start — a Feather (steps 1, 3, 4) reads "1 3 4" — and an off-beat
 * renders as its symbol (&/e/a) alone, consuming no number. A break reports
 * the phrase span it covers (e.g. "beats 4–6") plus its bar count.
 *
 * Pure and display-only: the underlying float counts are untouched (the edit view
 * keeps per-figure LOCAL counts). Output is aligned 1:1 with `entries`.
 */
export function numberRoutineBeats(
  entries: RoutineBeatEntry[],
  dance: DanceId,
): NumberedBeatEntry[] {
  const { phraseBeats, beatsPerBar } = DANCES[dance];
  let beat = 0; // running whole-beat index across the routine (0-based)
  return entries.map((entry) => {
    if (entry.kind === "break") {
      const beats = Math.max(1, entry.beats);
      const startBeat = (beat % phraseBeats) + 1;
      beat += beats;
      const endBeat = ((beat - 1) % phraseBeats) + 1;
      const bars = Math.max(1, Math.round(beats / beatsPerBar));
      const span = beats === 1 ? `beat ${startBeat}` : `beats ${startBeat}–${endBeat}`;
      return { kind: "break", beats, bars, startBeat, endBeat, span };
    }
    const startBeat = beat; // the block's start — every step numbers from here
    const tokens = entry.counts.map((count) => {
      const symbol = offBeatSymbol(count);
      if (symbol !== null) return symbol; // off-beat: symbol only, no number consumed
      return String(((startBeat + Math.floor(count) - 1) % phraseBeats) + 1);
    });
    beat += figureBeatSpan(entry);
    return { kind: "figure", tokens };
  });
}

/** The whole beats a figure entry occupies: its authored `beats` when given
 *  (≥1), else the last whole beat any of its steps covers (an off-beat rides
 *  within its beat), else 0 — an unloaded/empty figure contributes no time. */
function figureBeatSpan(entry: { counts: number[]; beats?: number }): number {
  if (typeof entry.beats === "number" && entry.beats >= 1) return Math.floor(entry.beats);
  let last = 0;
  for (const count of entry.counts) last = Math.max(last, Math.floor(count));
  return last;
}
