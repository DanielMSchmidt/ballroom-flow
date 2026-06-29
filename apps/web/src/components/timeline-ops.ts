// Pure timeline operations for the figure editor (FigureTimeline). Kept separate
// from the React component so the musical maths (durations, snap-grid resize) is
// unit-testable in isolation.
import type { Attribute } from "@ballroom/domain";

/** Snap-grid options for the editor's duration grid (design: ¼ · ⅛ · 1). */
export const SNAP_OPTIONS = [
  { value: 0.25, label: "¼" },
  { value: 0.125, label: "⅛" },
  { value: 1, label: "1" },
] as const;

export type SnapValue = (typeof SNAP_OPTIONS)[number]["value"];

/** Round a count onto the 1/8 grid so float arithmetic doesn't drift. */
export function snapTo(count: number, grid = 0.125): number {
  return Math.round(count / grid) * grid;
}

/** A step's duration = the gap to the next placed count, else a whole beat. */
export function stepDuration(count: number, allCounts: number[]): number {
  const next = allCounts.filter((c) => c > count).sort((a, b) => a - b)[0];
  return next != null ? snapTo(next - count) : 1;
}

/** Human label for a duration in beats, using the design's fraction glyphs. */
export function durationLabel(beats: number): string {
  const FRACTIONS: Record<string, string> = {
    "0.125": "⅛",
    "0.25": "¼",
    "0.375": "⅜",
    "0.5": "½",
    "0.625": "⅝",
    "0.75": "¾",
    "0.875": "⅞",
  };
  if (beats === 1) return "1 beat";
  const whole = Math.floor(beats);
  const frac = snapTo(beats - whole);
  const glyph = FRACTIONS[String(frac)];
  if (whole === 0 && glyph) return `${glyph} beat`;
  if (glyph) return `${whole}${glyph} beats`;
  return `${beats} beats`;
}

/**
 * Resize the step at `count` to `newDuration` beats. Duration is the gap to the
 * next step, so resizing shifts every later count by the delta (preserving the
 * gaps between later steps) — "inserting"/"removing" time at this point in the
 * figure. The last step has no following step to push, so it can't be resized:
 * callers should disable the handle there. Returns the next full attribute set.
 */
export function resizeStepDuration(
  attrs: Attribute[],
  count: number,
  newDuration: number,
): Attribute[] {
  const live = attrs.filter((a) => a.deletedAt == null);
  const laterCounts = live.map((a) => a.count).filter((c) => c > count);
  if (laterCounts.length === 0) return attrs; // last step: nothing to push
  const oldDuration = Math.min(...laterCounts) - count;
  const delta = snapTo(newDuration - oldDuration);
  if (delta === 0) return attrs;
  return attrs.map((a) =>
    a.deletedAt == null && a.count > count ? { ...a, count: snapTo(a.count + delta) } : a,
  );
}
