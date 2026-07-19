// attribute-predicate-anchors — matchPredicate (docs/concepts/annotations.md § Anchors).
//
// The counts an `attributePredicate` anchor matches over a RESOLVED figure timeline. This
// generalizes the O(1) identity match `matchesFigureType` (figuretype.ts) to a content
// predicate over notation, matched BY MEANING via the registry read-aliases (normalizeValue)
// — the same normalization the read path already applies to persisted values.
//
// PURE: no I/O, no Date.now(). Operates on a resolved figure SNAPSHOT (post-variant
// resolveFigure output), so a variant-owned beat matches by what the dancer actually sees.
import type { Anchor, Attribute, FigureDoc, Role } from "./doc-types";
import { resolveFigureCounts } from "./figure-grid";
import { normalizeValue } from "./vocabulary";

/**
 * The absence sentinel: an anchor `value` of `PREDICATE_NONE` matches every whole beat
 * carrying NO applicable live attribute of the anchor's kind ("every step with no sway
 * logged"). Absence is an explicit, selectable match value.
 */
export const PREDICATE_NONE = "none";

/** The whole beat a count belongs to: beat b covers counts in [b, b+1) (the `beatOf`
 *  convention, fork.ts). */
const beatOf = (count: number): number => Math.floor(count);

/** Is this attribute applicable to the anchor: same kind, live, role-compatible? A
 *  both-sides value (role null) applies to either role lens; an anchor with no role
 *  matches any side. */
function applies(a: Attribute, kind: string, role: Role): boolean {
  if (a.deletedAt != null) return false;
  if (a.kind !== kind) return false;
  return role == null || a.role == null || a.role === role;
}

/**
 * The counts of `figure` an attributePredicate anchor matches — sorted, deduped.
 * PURE; operates on a RESOLVED figure snapshot (post-variant resolveFigure output).
 * Returns [] for non-attributePredicate anchors and out-of-scope dances. `routineRef`
 * confinement (scope "routine") is the CALLER's gate — a bare figure doesn't know its
 * routine.
 */
export function matchPredicate(
  anchor: Anchor,
  figure: Pick<FigureDoc, "dance" | "attributes" | "counts" | "bars">,
): number[] {
  if (anchor.type !== "attributePredicate") return [];
  // Scope gate: "all" always passes; a DanceId requires dance equality; "routine"
  // passes here (the caller confines it by routineRef).
  if (anchor.scope !== "all" && anchor.scope !== "routine" && anchor.scope !== figure.dance) {
    return [];
  }
  const role = anchor.role ?? null;

  if (anchor.value === PREDICATE_NONE) {
    // Absence: whole beats 1..resolveFigureCounts carrying no applicable live attribute.
    const blocked = new Set<number>();
    for (const a of figure.attributes) {
      if (applies(a, anchor.kind, role)) blocked.add(beatOf(a.count));
    }
    const total = resolveFigureCounts({ ...figure, attributes: figure.attributes });
    const out: number[] = [];
    for (let b = 1; b <= total; b++) {
      if (!blocked.has(b)) out.push(b);
    }
    return out;
  }

  // Value match by meaning: normalize both sides through the kind's read aliases.
  const target = normalizeValue(anchor.kind, anchor.value);
  const counts = new Set<number>();
  for (const a of figure.attributes) {
    if (!applies(a, anchor.kind, role)) continue;
    if (typeof a.value !== "string") continue;
    if (normalizeValue(anchor.kind, a.value) === target) counts.add(a.count);
  }
  return [...counts].sort((x, y) => x - y);
}
