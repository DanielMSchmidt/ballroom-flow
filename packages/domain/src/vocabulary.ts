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
  /**
   * When true, `values` are SUGGESTIONS, not a closed enum — a free-text value is
   * also valid (§3: step is "controlled vocab + free-text action"). The strict
   * write-check (US-012) skips the unknown-value rejection for such kinds.
   */
  freeText?: boolean;
  /** When present, the kind applies only to these dances (e.g. rise omits Tango). */
  appliesToDances?: DanceId[];
  /**
   * One-line plain-language description of the kind — the prose the info-sheet
   * (§4.9, frame 1.13) shows under the title. Optional: a custom kind that
   * carries none falls back to the raw value list (still useful).
   */
  description?: string;
  /**
   * Per-value definitions keyed by the registry value (e.g. rise `commence` →
   * "the rise begins"; position `promenade` → "a V-shaped promenade position").
   * Power the info-sheet's per-value glossary. Optional + partial: only the
   * values you can define need an entry; the rest render with no prose.
   */
  valueDefs?: Record<string, string>;
  /**
   * Whether this kind commonly differs by leader/follower (research/domain.md:
   * the follower dances a different chart — direction mirrors, footwork differs,
   * sway/turn mirror). Drives an L/F affordance in Profile's attribute-types
   * manager + the add-kind picker. A per-figure VIEW concern, not stored identity.
   */
  roleAware?: boolean;
  /**
   * Whether this kind is a "required"/core slot. The notate EDIT grid marks the
   * merged Step column "Step*" (FigureTimeline `col.isStep`, whose driving kind
   * is `direction`) — so `direction` carries `required:true` to match that UI.
   */
  required?: boolean;
  /** true for standard kinds shipped here; false for user-defined kinds. */
  builtin: boolean;
}

/** The statically-known standard kinds, plus a string index for custom kinds. */
export interface StandardRegistry extends Record<string, RegistryKind> {
  /** The step's travel direction — its headline (forward/back/side/…). */
  direction: RegistryKind;
  /** The foot part of the step (ball/heel/…). Renamed from the old `step` kind. */
  footwork: RegistryKind;
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
  // The step's travel direction — the step headline (2026-06-28 parity spec).
  // Foot (L/R) is never modelled: steps alternate feet automatically. A closed
  // enum (no freeText) — direction is a controlled vocabulary.
  direction: {
    kind: "direction",
    label: "Direction",
    color: "#2f5d8f",
    cardinality: "single",
    valueType: "enum",
    values: ["forward", "back", "side", "close", "diag_forward", "diag_back", "in_place"],
    description: "Which way the step travels across the floor — the step's headline.",
    valueDefs: {
      forward: "Forward — stepping forward along your line",
      back: "Back — stepping backward",
      side: "Side — stepping to the side",
      close: "Close — feet close together, no travel",
      diag_forward: "Diagonal forward — forward on a diagonal",
      diag_back: "Diagonal back — back on a diagonal",
      in_place: "In place — a weight change with no travel",
    },
    // Direction mirrors by role (leader forward ⇄ follower back). It also drives
    // the merged "Step*" column, the one slot the notate grid marks required.
    roleAware: true,
    required: true,
    builtin: true,
  },
  // The foot part of the step (renamed from the old `step` kind, which held the
  // same foot-part pressure tokens). Readable value set; `freeText` keeps the
  // classic ISTD tokens (HT/TH/heel_pull) and one-offs valid, and the read-side
  // aliases below normalize the clean singles (H→heel, T→toe). Single-select:
  // a step has one foot part (a roll is one compound token, e.g. ball_flat).
  footwork: {
    kind: "footwork",
    label: "Footwork",
    color: "#a9742c",
    cardinality: "single",
    valueType: "enum",
    values: ["ball", "ball_flat", "flat", "heel", "heel_ball", "toe", "tap"],
    freeText: true,
    description:
      "The part of the foot contacting the floor through the step — read in order of contact.",
    valueDefs: {
      ball: "Ball — ball of the foot",
      ball_flat: "Ball-Flat — ball, then lowering to flat",
      flat: "Flat — the whole foot flat",
      heel: "Heel — heel leads, e.g. forward walks",
      heel_ball: "Heel-Ball — heel, then rising to ball",
      toe: "Toe — ball/toe only, e.g. side steps in rise",
      tap: "Tap — a tap with no weight taken",
    },
    // Footwork genuinely differs by role (e.g. heel turns are the follower's).
    roleAware: true,
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
    description: "Rise & fall — the rise and lowering of the body and feet through the step.",
    valueDefs: {
      commence: "Commence — the rise begins",
      body_rise: "Body rise — rise through the body, feet still flat",
      foot_rise: "Foot rise — rise onto the feet",
      up: "Up — fully risen",
      continue: "Continue — stay up",
      lowering: "Lowering — lowering down",
      NFR: "NFR — no foot rise",
    },
    // The couple rise & lower together — a shared figure characteristic, not role-split.
    builtin: true,
  },
  position: {
    kind: "position",
    label: "Position",
    color: "#8a5cab",
    cardinality: "single",
    valueType: "enum",
    values: ["closed", "promenade", "wing"],
    description: "The hold or dance position the step is danced in.",
    valueDefs: {
      closed: "Closed — closed hold, partners square",
      promenade: "Promenade — a V-shaped promenade position",
      wing: "Wing — wing position",
    },
    // The hold is shared by the couple, so it isn't role-split.
    builtin: true,
  },
  bodyActions: {
    kind: "bodyActions",
    label: "Body Actions",
    color: "#8a5cab",
    cardinality: "multi",
    valueType: "enum",
    values: ["CBM", "CBMP"],
    description: "Body actions used through the step (more than one can apply).",
    valueDefs: {
      CBM: "CBM — Contrary Body Movement: turning the opposite side toward the moving leg",
      CBMP: "CBMP — CBM Position: the foot placed across without the body turn",
    },
    // CBM/CBMP are applied by the turning dancer, so they commonly differ by role.
    roleAware: true,
    builtin: true,
  },
  sway: {
    kind: "sway",
    label: "Sway",
    color: "#c0563f",
    cardinality: "single",
    valueType: "enum",
    values: ["to_L", "to_R", "none"],
    description: "The lean of the body away from the moving foot.",
    valueDefs: {
      to_L: "To L — sway to the left",
      to_R: "To R — sway to the right",
      none: "None — no sway",
    },
    // Sway mirrors between partners, so it reads differently per role.
    roleAware: true,
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
    description: "How much the step turns, and in which direction.",
    valueDefs: {
      none: "None — no turn",
      eighth_L: "⅛ L — an eighth turn to the left",
      eighth_R: "⅛ R — an eighth turn to the right",
      quarter_L: "¼ L — a quarter turn to the left",
      quarter_R: "¼ R — a quarter turn to the right",
      three_eighth_L: "⅜ L — three eighths to the left",
      three_eighth_R: "⅜ R — three eighths to the right",
      half_L: "½ L — a half turn to the left",
      half_R: "½ R — a half turn to the right",
    },
    // Turn amount often mirrors between partners, so it reads differently per role.
    roleAware: true,
    builtin: true,
  },
};

// Read-side value aliases (Q-D4). Keyed by kind → { alias: canonical }. Unknown
// values that aren't aliases pass through untouched (forward-compatible reads).
const VALUE_ALIASES: Record<string, Record<string, string>> = {
  bodyActions: { CBP: "CBMP" },
  // Legacy ISTD single tokens → the readable footwork values (2026-06-28 parity).
  // The compound tokens (HT/TH/heel_pull) have no clean readable equivalent, so
  // they pass through as free-text rather than being lossily rewritten.
  footwork: { H: "heel", T: "toe" },
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
 * BUILTIN SLUGS ARE RESERVED (§3, D22, §10.2): a custom kind whose slug collides
 * with a builtin is **ignored — the builtin wins**. The plan describes two tiers
 * *merged* and custom-kind *creation*; it never sanctions a user kind replacing a
 * builtin. Letting one through would, for example, let a custom kind keyed `rise`
 * drop its `appliesToDances` and re-enable rise for Tango — the very §10.2
 * invariant US-003 protects. Guarding here (not just at the US-043 creation UI)
 * makes the registry safe by construction regardless of how a custom kind arrives
 * (creation UI, import, migration).
 */
export function mergeRegistry(
  base: StandardRegistry,
  custom: RegistryKind[],
): StandardRegistry & Record<string, RegistryKind> {
  const merged: StandardRegistry & Record<string, RegistryKind> = { ...base };
  for (const kind of custom) {
    // Reserve builtin slugs: a custom kind cannot override a standard one.
    if (base[kind.kind]?.builtin) continue;
    merged[kind.kind] = kind;
  }
  return merged;
}

/** Lowercase, collapse non-alphanumerics to `_`, trim `_` — a safe kind slug. */
export function slugifyKind(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** True when `slug` collides with a builtin kind (reserved — builtins win). */
export function isReservedKind(slug: string): boolean {
  return ATTRIBUTE_REGISTRY[slug]?.builtin === true;
}

/**
 * Whether a builtin kind applies to a dance — `rise` omits Tango via its
 * `appliesToDances` (§3/§10.2). A kind with no `appliesToDances` applies to every
 * dance; an unknown dance (`undefined`) is permissive. The single source the
 * reading view (hide the inapplicable column) and the write paths (reject/drop an
 * inapplicable value — the store seam + the domain `parseAttributeWrite` gate)
 * share, so the rule lives in exactly one place.
 */
export function kindAppliesToDance(kind: string, dance: DanceId | undefined): boolean {
  if (dance === undefined) return true;
  const reg = ATTRIBUTE_REGISTRY[kind];
  return !reg?.appliesToDances || reg.appliesToDances.includes(dance);
}
