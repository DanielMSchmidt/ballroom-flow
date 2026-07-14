// US-011 — figureType annotation resolution (PLAN §2.6, §5.1, D29).
//
// A figureType note is anchored to a figure FAMILY (a stable cross-dance identity
// like `feather`), not a specific figure doc — so it surfaces on every figure of
// that family. Matching is IDENTITY-BASED (exact figureType equality), not a
// predicate query, and pure/deterministic: it reads only the anchor + the figure
// doc's own `figureType`/`dance`.
//
// Scope:
//   • danceScope "all"  → matches the family in ANY dance (e.g. "on every
//     Feather" lands on the Foxtrot Feather AND the Waltz Feather);
//   • danceScope <dance> → matches the family only in that dance.
//
// Variants inherit identity: a variant figure doc carries its base's `figureType`
// and `dance` (§2.2), so family notes match it through its own fields — no
// overlay resolution needed here.
//
// NOTE: this is pure family MATCHING. Whether a given user may SEE a co-member's
// family note (the option-2 co-membership gate) is the worker layer's concern
// (US-041), not this function.
import type { Anchor, FigureDoc } from "./doc-types";
import { resolveFigureCounts } from "./figure-grid";

/**
 * True when a figureType note `anchor` applies to `figure`: same family
 * (`figureType` identity) AND the anchor's dance scope covers the figure's dance
 * (`"all"`, or an exact dance match). Non-figureType anchors never match.
 */
export function matchesFigureType(anchor: Anchor, figure: FigureDoc): boolean {
  if (anchor.type !== "figureType") return false;
  if (anchor.figureType !== figure.figureType) return false;
  return anchor.danceScope === "all" || anchor.danceScope === figure.dance;
}

/**
 * The count a TIMED figureType note (WEP-0004) pins to on `figure`, or `null`
 * for figure-grain surfacing. Null when the anchor is untimed, doesn't match
 * the figure, or the figure's resolved length doesn't cover the count — the
 * soft fallback: a family sibling whose variant is shorter still SHOWS the
 * note (via {@link matchesFigureType}), just un-pinned, never hidden.
 */
export function figureTypeNoteCount(anchor: Anchor, figure: FigureDoc): number | null {
  if (anchor.type !== "figureType" || anchor.count == null) return null;
  if (!matchesFigureType(anchor, figure)) return null;
  return anchor.count <= resolveFigureCounts(figure) ? anchor.count : null;
}
