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
