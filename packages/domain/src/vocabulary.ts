// @ballroom/domain — SLOT_REGISTRY: the single source of truth for technique-slot
// vocabulary (design §3.0). The tag editor, Lanes view, glossary, chips, Zod validation
// AND the custom-attribute derivation (see custom.ts) all read this one registry, so a new
// value or a new dance/role rule is a config edit rather than an N-place change.

export type DanceId = "waltz" | "viennese_waltz" | "quickstep" | "foxtrot" | "tango";
export type StepRole = "leader" | "follower";
export type Cardinality = "single" | "multi";

export const ALL_DANCES: readonly DanceId[] = [
  "waltz",
  "viennese_waltz",
  "quickstep",
  "foxtrot",
  "tango",
];
export const ALL_ROLES: readonly StepRole[] = ["leader", "follower"];

export interface SlotValueDef {
  value: string;
  label: string;
  /** Old keys that normalize to `value` on read (forward-compat, e.g. CBP → CBMP). */
  aliases?: string[];
}

export interface SlotDef {
  key: string;
  label: string;
  /** Display color (chips / Lanes / glossary all read it from here). */
  color: string;
  cardinality: Cardinality;
  values: SlotValueDef[];
  /** Omit a dance to hide the slot for it. Undefined = applies to all dances. */
  appliesToDances?: DanceId[];
  /** Undefined = applies to both roles. */
  appliesToRoles?: StepRole[];
  /** Core 5 live as typed columns; future non-core slots use the attribute seam. */
  storage: "column" | "attribute";
}

/** Bumped when values are renamed/removed so exports can remap via aliases (design §3.0). */
export const SLOT_REGISTRY_VERSION = 1;

/**
 * The v1 technique slots (design §3.1–§3.5). `foot` (Footwork) is the attribute every
 * library figure must carry — see figures.ts and the data-quality test in figures.test.ts.
 */
export const SLOT_REGISTRY: readonly SlotDef[] = [
  {
    key: "rise",
    label: "Rise & Fall",
    color: "#1f8a5b",
    cardinality: "single",
    // Tango omitted => the rise slot is simply absent for Tango (retires `hasRiseFall`).
    appliesToDances: ["waltz", "viennese_waltz", "quickstep", "foxtrot"],
    storage: "column",
    values: [
      { value: "commence", label: "Commence to rise" },
      { value: "body_rise", label: "Body rise" },
      { value: "foot_rise", label: "Foot rise" },
      { value: "up", label: "Up" },
      { value: "continue", label: "Continue to rise" },
      { value: "lowering", label: "Lowering" },
      { value: "NFR", label: "No foot rise" },
    ],
  },
  {
    key: "body",
    label: "Body Position",
    color: "#8a5cab",
    cardinality: "single",
    storage: "column",
    values: [
      { value: "closed", label: "Closed" },
      { value: "promenade", label: "Promenade (PP)" },
      { value: "wing", label: "Wing" },
    ],
  },
  {
    key: "bodyActions",
    label: "Body Action",
    color: "#8a5cab",
    cardinality: "multi",
    storage: "column",
    values: [
      { value: "CBM", label: "CBM" },
      // "CBP" in the wireframe is a suspected typo for CBMP (design §3.2 Q-D4).
      { value: "CBMP", label: "CBMP", aliases: ["CBP"] },
    ],
  },
  {
    key: "foot",
    label: "Footwork",
    color: "#a9742c",
    cardinality: "single",
    storage: "column",
    values: [
      { value: "HT", label: "Heel Toe" },
      { value: "T", label: "Toe" },
      { value: "TH", label: "Toe Heel" },
      { value: "heel_pull", label: "Heel Pull" },
      { value: "H", label: "Heel" },
    ],
  },
  {
    key: "sway",
    label: "Sway",
    color: "#c0563f",
    cardinality: "single",
    storage: "column",
    values: [
      { value: "to_L", label: "To Left" },
      { value: "to_R", label: "To Right" },
      { value: "none", label: "None" },
    ],
  },
  {
    key: "turn",
    label: "Turn",
    color: "#5b6b8a",
    cardinality: "single",
    storage: "column",
    values: [
      { value: "eighth_L", label: "⅛ to L" },
      { value: "eighth_R", label: "⅛ to R" },
      { value: "quarter_L", label: "¼ to L" },
      { value: "quarter_R", label: "¼ to R" },
      { value: "three_eighth_L", label: "⅜ to L" },
      { value: "three_eighth_R", label: "⅜ to R" },
      { value: "half_L", label: "½ to L" },
      { value: "half_R", label: "½ to R" },
      { value: "none", label: "None" },
    ],
  },
] as const;

/** Slot keys, in registry order. */
export const SLOT_KEYS: readonly string[] = SLOT_REGISTRY.map((s) => s.key);

const SLOT_BY_KEY = new Map<string, SlotDef>(SLOT_REGISTRY.map((s) => [s.key, s]));

export function getSlot(key: string): SlotDef | undefined {
  return SLOT_BY_KEY.get(key);
}

/** The slots that apply to a given (dance, role) — drives the editor, Lanes, and diffing. */
export function slotsFor(dance: DanceId, role: StepRole): SlotDef[] {
  return SLOT_REGISTRY.filter(
    (s) =>
      (!s.appliesToDances || s.appliesToDances.includes(dance)) &&
      (!s.appliesToRoles || s.appliesToRoles.includes(role)),
  );
}

/** Normalize a stored value through known aliases (forward-compat read). */
export function normalizeSlotValue(key: string, value: string): string {
  const slot = SLOT_BY_KEY.get(key);
  if (!slot) return value;
  const match = slot.values.find((v) => v.value === value || v.aliases?.includes(value));
  return match ? match.value : value;
}
