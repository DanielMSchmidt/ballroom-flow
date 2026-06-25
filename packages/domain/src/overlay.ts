// US-006 — Overlay resolution `resolve(base, overlay)` (PLAN §2.2, §5.2).
//
// A figure variant does NOT duplicate its base — it stores only an Overlay of
// divergences (overrides / tombstones / additions / rename) against a base
// FigureDoc. `resolve` computes the variant's *effective* figure by layering the
// overlay onto the LIVE base:
//
//   effective.attributes = (base.attributes − tombstones, with overrides applied)
//                           ++ additions
//   effective.name        = overlay.rename ?? base.name
//
// Because resolution reads the live base, a later edit to a NON-overridden base
// attribute (or a brand-new base attribute) flows up into every variant
// automatically — that "base-addition flow-up" is the whole point of overlays
// vs. a frozen fork (US-007). The function is PURE and deterministic: it never
// mutates the base or overlay, so the same inputs always yield the same output.
import type { Attribute, FigureDoc, Overlay } from "./doc-types";

/**
 * Resolve a variant's effective figure by layering `overlay` onto `base`.
 *
 * Override semantics: `overlay.overrides` maps a base attribute id → its
 * replacement `value`; the rest of that attribute (kind/count/role) is inherited
 * from the base, so an override re-values a step without re-describing it.
 */
export function resolve(base: FigureDoc, overlay: Overlay): FigureDoc {
  const tombstoned = new Set(overlay.tombstones);

  const inherited: Attribute[] = base.attributes
    .filter((attr) => !tombstoned.has(attr.id))
    .map((attr) =>
      attr.id in overlay.overrides ? { ...attr, value: overlay.overrides[attr.id] } : { ...attr },
    );

  // Additions are variant-only attributes; clone so the overlay is never shared
  // by reference into the resolved result.
  const additions: Attribute[] = overlay.additions.map((attr) => ({ ...attr }));

  return {
    ...base,
    name: overlay.rename ?? base.name,
    attributes: [...inherited, ...additions],
  };
}
