/**
 * Token references for TS consumers.
 * =================================================================
 * Components that need to pick a token programmatically (e.g. render
 * an attribute chip whose color depends on the kind, driven by the
 * registry — DESIGN-PRINCIPLES #24) reference these CSS-variable
 * names instead of hardcoding hex. The actual values live in
 * styles/tokens.css; here we only name them.
 */

/** The standard attribute-kind ids with a token color family (PLAN §3;
 *  2026-06-28 parity adds `direction`, renames `step`→`footwork`). User-defined
 *  kinds extend the registry at runtime; the UI must not hardcode this list for
 *  rendering — it's here only to type the standard palette. */
export const ATTRIBUTE_KINDS = [
  "direction",
  "footwork",
  "rise",
  "position",
  "bodyActions",
  "sway",
  "turn",
] as const;
export type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];

/** Runtime narrowing to a STANDARD attribute kind. User-defined kinds extend the
 *  registry at runtime and are NOT in this list, so this is a real membership test —
 *  use it instead of asserting `kind as AttributeKind` (CLAUDE.md §4). */
export function isAttributeKind(kind: string): kind is AttributeKind {
  return ATTRIBUTE_KINDS.some((k) => k === kind);
}

/** CSS-variable names for an attribute kind's color family. Use with
 *  `var(...)`, e.g. `style={{ color: kindVar(kind, "ink") }}`. For a
 *  user-defined kind whose color isn't in the standard set, pass the
 *  kind's stored color through directly. */
export function kindVar(kind: AttributeKind, role: "base" | "ink" | "tint" | "border" = "base") {
  const suffix = role === "base" ? "" : `-${role}`;
  return `var(--bf-kind-${kind}${suffix})`;
}

/** The two figure scopes — by content divergence (PLAN §4.3, DESIGN-PRINCIPLES #11):
 *  - `library` — matches the app-owned catalog (global or account copy that still agrees)
 *  - `custom`  — diverged from or unrelated to the catalog (user's own edits) */
export const FIGURE_SCOPES = ["library", "custom"] as const;
export type FigureScope = (typeof FIGURE_SCOPES)[number];

/** Identity color slots (member note colors / avatars). CSS variable names — use
 *  with `var(...)` to paint swatches so components never hard-code hex. */
export const IDENTITY_COLORS = [
  "var(--bf-identity-1)",
  "var(--bf-identity-2)",
  "var(--bf-identity-3)",
  "var(--bf-identity-4)",
  "var(--bf-identity-5)",
  "var(--bf-identity-6)",
] as const;

/** Canonical hex values for the identity colour slots — the single source of
 *  truth that the onboarding endpoint validates and that authorship tints read
 *  back as.  Mirrors `--bf-identity-1..6` in `styles/tokens.css`. */
export const IDENTITY_HEX = [
  "#3b7dd8", // slot 1 — blue
  "#1f8a5b", // slot 2 — green
  "#c0563f", // slot 3 — terracotta
  "#8a5cab", // slot 4 — violet
  "#d99a2b", // slot 5 — gold
  "#4a9d9a", // slot 6 — teal
] as const;

/** Curated, contrast-safe swatches a user picks from for a custom attribute
 *  kind's colour. A custom kind paints its single stored colour as chip TEXT +
 *  BORDER over the light sunken well (`--bf-surface-sunken` = #f7f5f0) wherever
 *  it renders — the reading timeline (AttrChip), the figure-editor grid, and the
 *  type-filter chips — so a free colour picker can yield illegible light values
 *  (yellow, pale green, the old #888888 default). Every hex here was WCAG-checked
 *  to clear **AA (≥4.5:1)** as text on that surface, so *any* choice stays
 *  readable in the timeline; the hues are spread around the wheel so kinds stay
 *  tellable apart. Ordered by hue for a pleasant swatch row. */
export const CUSTOM_KIND_SWATCHES = [
  "#3a4a63", // slate
  "#2f5d8f", // blue
  "#4a4d9c", // indigo
  "#6b4a9c", // violet
  "#9c3d7a", // magenta
  "#b03a5b", // rose
  "#b0472f", // terracotta
  "#8a6a1c", // gold
  "#6b4a2c", // cocoa
  "#5e6b1f", // olive
  "#1f7a4d", // green
  "#0f6b66", // teal
] as const;
