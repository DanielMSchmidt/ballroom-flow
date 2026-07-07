// US-004 / US-028 — bars-driven figure timing grid (PLAN §2.5, §4.4).
//
// A figure carries an explicit length in musical bars (`FigureDoc.bars`). The
// figure editor renders EVERY possible timing that length allows — not just the
// counts that already carry a value — so nothing is missed. These pure helpers
// derive that grid from the bar count and the dance's beats-per-bar (DANCES,
// US-002 — never re-derived here).
//
// The grid, per bar b (1-indexed) → beat k (1..beatsPerBar) → the whole beat and
// then its in-between slots e (¼), & (½), a (¾):
//   count(b, k) = (b - 1) * beatsPerBar + k       // the whole-beat count
//   sub-beats   = count + 0.25 / 0.5 / 0.75        // e / & / a
// so a Waltz bar 2 beat 1 is count 4, its "&" is 4.5 → label "4&" (countLabel).
import { DANCES, type DanceId } from "./dances";
import type { Attribute } from "./doc-types";
import { countLabel } from "./timing";

/** The in-between subdivisions of a beat, in order: e (¼), & (½), a (¾). */
export const SUB_BEATS = [0.25, 0.5, 0.75] as const;

/** One cell-row of the editor's timing grid: a whole beat or one of its
 *  sub-beats, tagged with the bar/beat it belongs to for grouping + dimming. */
export interface GridSlot {
  /** The float count this slot sits on (relative to figure start, 1-indexed). */
  count: number;
  /** Conventional ballroom label, e.g. "1", "1e", "1&", "1a", "4" (countLabel). */
  label: string;
  /** 1-indexed bar this slot belongs to (drives the "bar N" divider). */
  bar: number;
  /** 1-indexed beat within the whole figure (the whole-beat count). */
  beat: number;
  /** true for the on-beat (solid) row, false for an e/&/a sub-beat (dimmed). */
  whole: boolean;
}

/**
 * The default COUNT length for a figure: the number of distinct whole-beat
 * steps (integer counts carrying ≥1 live attribute), at least 1. Used to seed a
 * new figure's length and as the fallback when a doc has neither an authored
 * `counts` nor a legacy `bars` (see {@link resolveFigureCounts}).
 */
export function defaultFigureCounts(attributes: Attribute[]): number {
  const wholeBeats = new Set<number>();
  for (const a of attributes) {
    if (a.deletedAt != null) continue;
    if (Number.isInteger(a.count)) wholeBeats.add(a.count);
  }
  return Math.max(1, wholeBeats.size);
}

/**
 * The default bar count for a figure: ⌈{@link defaultFigureCounts} ÷
 * beatsPerBar⌉, at least 1. Retained for count-less callers (catalog charts);
 * length-aware callers go through {@link resolveFigureCounts}.
 */
export function defaultFigureBars(attributes: Attribute[], dance: DanceId): number {
  const { beatsPerBar } = DANCES[dance];
  return Math.max(1, Math.ceil(defaultFigureCounts(attributes) / beatsPerBar));
}

/**
 * A figure's effective length in COUNTS (Builder v3 ①, 2026-07-07): the
 * authored `counts` when set, else a legacy authored `bars × beatsPerBar`
 * (pre-v5 docs — the v4→v5 migration converts them in storage, this is the
 * lenient read), else {@link defaultFigureCounts} over its attributes.
 * Non-positive stored values clamp to ≥1 so a corrupt doc still renders.
 */
export function resolveFigureCounts(figure: {
  counts?: number;
  bars?: number;
  attributes: Attribute[];
  dance: DanceId;
}): number {
  if (typeof figure.counts === "number" && figure.counts >= 1) return Math.floor(figure.counts);
  const { beatsPerBar } = DANCES[figure.dance];
  if (typeof figure.bars === "number" && figure.bars >= 1) {
    return Math.floor(figure.bars) * beatsPerBar;
  }
  return defaultFigureCounts(figure.attributes);
}

/**
 * A figure's effective bar count — DERIVED: ⌈{@link resolveFigureCounts} ÷
 * beatsPerBar⌉. Every bar display (routine cards, section sums, numbering
 * ends) reads through here; `bars` is no longer authored (Builder v3 ①).
 */
export function resolveFigureBars(figure: {
  counts?: number;
  bars?: number;
  attributes: Attribute[];
  dance: DanceId;
}): number {
  const { beatsPerBar } = DANCES[figure.dance];
  return Math.max(1, Math.ceil(resolveFigureCounts(figure) / beatsPerBar));
}

/**
 * Every timing slot a `bars`-long figure in `dance` can hold, in count order:
 * for each bar → each beat (1..beatsPerBar) → the whole beat, then its e/&/a
 * sub-beats. This is the editor grid's row source (US-028) — the rows come from
 * the bar count, NOT from the existing steps, so every place a value could go is
 * shown. `bars` is clamped to ≥1.
 */
export function figureGridSlots(bars: number, dance: DanceId): GridSlot[] {
  const { beatsPerBar } = DANCES[dance];
  return figureCountSlots(Math.max(1, Math.floor(bars)) * beatsPerBar, dance);
}

/**
 * Every timing slot a `counts`-long figure in `dance` can hold, in count order:
 * each whole beat then its e/&/a sub-beats, tagged with the bar it falls in
 * (⌈beat / beatsPerBar⌉ — drives the "bar N" divider). The COUNT-length
 * counterpart to {@link figureGridSlots} (Builder v3 ①): a figure's length is
 * authored in beats, not whole bars, so the grid may end mid-bar. `counts` is
 * clamped to ≥1.
 */
export function figureCountSlots(counts: number, dance: DanceId): GridSlot[] {
  const { beatsPerBar } = DANCES[dance];
  const countTotal = Math.max(1, Math.floor(counts));
  const slots: GridSlot[] = [];
  for (let beat = 1; beat <= countTotal; beat++) {
    const bar = Math.ceil(beat / beatsPerBar);
    slots.push({ count: beat, label: countLabel(beat), bar, beat, whole: true });
    for (const frac of SUB_BEATS) {
      const count = beat + frac;
      slots.push({ count, label: countLabel(count), bar, beat, whole: false });
    }
  }
  return slots;
}

/** A placement's portion window (Builder v3 ③): dance just the counts
 *  [fromCount, toCount] of the referenced figure. The figure doc stays whole
 *  and LIVE — reads window the resolved timeline, so a catalog edit inside the
 *  window flows in. Whole counts, 1-indexed relative to figure start. */
export interface PlacementPart {
  fromCount: number;
  toCount: number;
}

/** The live attributes inside a portion window — the last beat's e/&/a
 *  sub-beats ride with it. No part → the timeline passes through whole. */
export function windowAttributes<T extends { count: number }>(
  attributes: T[],
  part?: PlacementPart | null,
): T[] {
  if (!part) return attributes;
  const from = Math.max(1, Math.ceil(part.fromCount));
  const toExclusive = Math.floor(part.toCount) + 1;
  return attributes.filter((a) => a.count >= from && a.count < toExclusive);
}

/** The whole-beat span a portion window occupies (min 1) — a placement's beat
 *  contribution is the WINDOW's span, whether or not every beat carries steps. */
export function partBeatSpan(part: PlacementPart): number {
  const from = Math.max(1, Math.ceil(part.fromCount));
  return Math.max(1, Math.floor(part.toCount) - from + 1);
}
