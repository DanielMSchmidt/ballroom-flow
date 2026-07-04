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
 * The default bar count for a figure: ⌈(number of whole-beat steps) ÷
 * beatsPerBar⌉, at least 1. A "whole-beat step" is a distinct integer count that
 * carries ≥1 live (non-tombstoned) attribute — i.e. how many on-beat steps the
 * figure already has. Used to seed a new figure's length and as the fallback when
 * a doc has no explicit `bars` (see {@link resolveFigureBars}).
 */
export function defaultFigureBars(attributes: Attribute[], dance: DanceId): number {
  const { beatsPerBar } = DANCES[dance];
  const wholeBeats = new Set<number>();
  for (const a of attributes) {
    if (a.deletedAt != null) continue;
    if (Number.isInteger(a.count)) wholeBeats.add(a.count);
  }
  return Math.max(1, Math.ceil(wholeBeats.size / beatsPerBar));
}

/**
 * A figure's effective bar count: its explicit `bars` when set (the authored
 * length), else {@link defaultFigureBars} over its attributes. Tolerates a
 * non-positive stored value (clamps to ≥1) so a corrupt/legacy doc still renders.
 */
export function resolveFigureBars(figure: {
  bars?: number;
  attributes: Attribute[];
  dance: DanceId;
}): number {
  if (typeof figure.bars === "number" && figure.bars >= 1) return Math.floor(figure.bars);
  return defaultFigureBars(figure.attributes, figure.dance);
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
  const barCount = Math.max(1, Math.floor(bars));
  const slots: GridSlot[] = [];
  for (let bar = 1; bar <= barCount; bar++) {
    for (let k = 1; k <= beatsPerBar; k++) {
      const beat = (bar - 1) * beatsPerBar + k;
      slots.push({ count: beat, label: countLabel(beat), bar, beat, whole: true });
      for (const frac of SUB_BEATS) {
        const count = beat + frac;
        slots.push({ count, label: countLabel(count), bar, beat, whole: false });
      }
    }
  }
  return slots;
}
