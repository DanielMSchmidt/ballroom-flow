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
  "sway",
  "turn",
] as const;
export type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];

/** CSS-variable names for an attribute kind's color family. Use with
 *  `var(...)`, e.g. `style={{ color: kindVar(kind, "ink") }}`. For a
 *  user-defined kind whose color isn't in the standard set, pass the
 *  kind's stored color through directly. */
export function kindVar(kind: AttributeKind, role: "base" | "ink" | "tint" | "border" = "base") {
  const suffix = role === "base" ? "" : `-${role}`;
  return `var(--bf-kind-${kind}${suffix})`;
}

/** The three figure scopes (DESIGN-PRINCIPLES #11). */
export const FIGURE_SCOPES = ["global", "variant", "custom"] as const;
export type FigureScope = (typeof FIGURE_SCOPES)[number];

/** Identity color slots (member note colors / avatars). */
export const IDENTITY_COLORS = [
  "var(--bf-identity-1)",
  "var(--bf-identity-2)",
  "var(--bf-identity-3)",
  "var(--bf-identity-4)",
  "var(--bf-identity-5)",
  "var(--bf-identity-6)",
] as const;
