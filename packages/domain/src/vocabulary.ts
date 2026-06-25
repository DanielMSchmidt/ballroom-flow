// US-003 — ATTRIBUTE_REGISTRY + merge (PLAN §3, D17/D22, Q-D4).
//
// The single controlled vocabulary read everywhere: the attribute editor, the
// lanes view, info-sheet chips, and the Zod layer (US-012). Two tiers, merged:
//   • standard kinds — ship here, builtin:true (§3 line 153);
//   • user-defined kinds — created in-app (US-043), merged via mergeRegistry.
//
// Forward-compatible reads (§3): unknown values pass through on read, aliases
// normalize (CBP→CBMP), and unknown-value *writes* to a known kind are rejected
// — the write-side rejection lives in the Zod layer (US-012), not here. This
// module owns the vocabulary data, the merge, and read-side alias normalization.
//
// Attribute kinds are DATA, not code: the editor/lanes/chips render off this
// registry, so refining a value or color is a config edit, not a code change.
import type { DanceId } from "./dances";

/** A single attribute-kind descriptor (one registry entry). */
export interface RegistryKind {
  /** Stable kind id (e.g. "step", or a user-defined slug like "energy"). */
  kind: string;
  /** Human label for the editor/lanes. */
  label: string;
  /** Chip/lane accent color (hex). */
  color: string;
  /** single = one value per count; multi = a set of values per count. */
  cardinality: "single" | "multi";
  /** How the value is typed (e.g. "enum", "text"). */
  valueType: string;
  /** Enumerated values for enum kinds (omitted for free-text kinds). */
  values?: string[];
  /** When present, the kind applies only to these dances (e.g. rise omits Tango). */
  appliesToDances?: DanceId[];
  /** true for standard kinds shipped here; false for user-defined kinds. */
  builtin: boolean;
}

/** The statically-known standard kinds, plus a string index for custom kinds. */
export interface StandardRegistry extends Record<string, RegistryKind> {
  step: RegistryKind;
  rise: RegistryKind;
  position: RegistryKind;
  bodyActions: RegistryKind;
  sway: RegistryKind;
  turn: RegistryKind;
}

// The 4 travelling dances rise applies to — every Standard dance except Tango,
// which has no rise & fall (research/domain.md). Declared explicitly so adding a
// dance forces a conscious choice here rather than silently opting it in.
const RISE_DANCES: DanceId[] = ["waltz", "viennese_waltz", "quickstep", "foxtrot"];

/** The standard (builtin) attribute vocabulary. */
export const ATTRIBUTE_REGISTRY: StandardRegistry = {
  step: {
    kind: "step",
    label: "Step",
    color: "#a9742c",
    cardinality: "multi",
    valueType: "enum",
    // Footwork values + free-text action handled at the value level (US-012).
    values: ["HT", "T", "TH", "heel_pull", "H"],
    builtin: true,
  },
  rise: {
    kind: "rise",
    label: "Rise & Fall",
    color: "#1f8a5b",
    cardinality: "single",
    valueType: "enum",
    values: ["commence", "body_rise", "foot_rise", "up", "continue", "lowering", "NFR"],
    appliesToDances: RISE_DANCES,
    builtin: true,
  },
  position: {
    kind: "position",
    label: "Position",
    color: "#8a5cab",
    cardinality: "single",
    valueType: "enum",
    values: ["closed", "promenade", "wing"],
    builtin: true,
  },
  bodyActions: {
    kind: "bodyActions",
    label: "Body Actions",
    color: "#8a5cab",
    cardinality: "multi",
    valueType: "enum",
    values: ["CBM", "CBMP"],
    builtin: true,
  },
  sway: {
    kind: "sway",
    label: "Sway",
    color: "#c0563f",
    cardinality: "single",
    valueType: "enum",
    values: ["to_L", "to_R", "none"],
    builtin: true,
  },
  turn: {
    kind: "turn",
    label: "Turn",
    color: "#5b6b8a",
    cardinality: "single",
    valueType: "enum",
    values: [
      "none",
      "eighth_L",
      "eighth_R",
      "quarter_L",
      "quarter_R",
      "three_eighth_L",
      "three_eighth_R",
      "half_L",
      "half_R",
    ],
    builtin: true,
  },
};

// Read-side value aliases (Q-D4). Keyed by kind → { alias: canonical }. Unknown
// values that aren't aliases pass through untouched (forward-compatible reads).
const VALUE_ALIASES: Record<string, Record<string, string>> = {
  bodyActions: { CBP: "CBMP" },
};

/**
 * Normalize a value read for a kind: map known aliases to their canonical form
 * (e.g. bodyActions "CBP" → "CBMP"); pass any other value through unchanged.
 */
export function normalizeValue(kind: string, value: string): string {
  return VALUE_ALIASES[kind]?.[value] ?? value;
}

/**
 * Merge user-defined kinds into the standard registry, producing one vocabulary
 * indistinguishable downstream. The merge is additive and pure (the base
 * singleton is never mutated). User kinds are keyed by their `kind` slug.
 *
 * Collision policy is intentionally NOT relied upon here: the plan (§3, D22)
 * describes two tiers *merged* and custom-kind *creation*, but does not sanction
 * a user-defined kind replacing a builtin. A custom kind keyed `rise` would, for
 * example, clobber its `appliesToDances` and re-enable rise for Tango — the very
 * §10.2 invariant US-003 protects. Nothing can mint such a kind today (US-043,
 * the creation UI, is far off); when it lands it must reserve the builtin slugs.
 *
 * TODO(US-043): reject/namespace custom kinds whose slug collides with a builtin
 * (see task #17) so the merge can never override a standard kind.
 */
export function mergeRegistry(
  base: StandardRegistry,
  custom: RegistryKind[],
): StandardRegistry & Record<string, RegistryKind> {
  const merged: StandardRegistry & Record<string, RegistryKind> = { ...base };
  for (const kind of custom) {
    merged[kind.kind] = kind;
  }
  return merged;
}
