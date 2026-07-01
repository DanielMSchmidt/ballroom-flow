// Presentation helpers for the timeline views (read + write), matching the
// docs/design/ballroom-flow.pen "AssembleReading" + "FigureEditor" frames.
//
// The reading view (and the write editor's column header) lay attributes out as
// a fixed set of technique COLUMNS — Rise, Body, Footwork, Sway, Turn — each a
// tight ~30px cell. To fit, enum values render as short CODES (e.g. commence →
// "com", quarter_R → "¼R"). `direction` is never a column: it's the step's
// headline ("RF forward"); foot (L/R) is not modelled — steps alternate feet
// automatically (see vocabulary.ts) — so it's derived from the step's order.
import type { AttributeKind } from "../ui/tokens";

/** A technique column in the reading table / editor header (design order). */
export interface AttrColumn {
  /** Two-letter code shown in the column header (design: Ri/Bo/Fw/Sw/Tn). */
  code: string;
  /** The column's color family (used to tint whatever value lands in it). */
  tone: AttributeKind;
  /** Attribute kinds this column can display, in priority order. "Body" carries
   *  both `position` and `bodyActions` (they share the purple body family). */
  kinds: string[];
}

/** The five technique columns, in the .pen design's left-to-right order.
 *  `direction` is the step headline (not a column); legacy/custom kinds are not
 *  columns either — they render as extra chips beside the headline. */
export const ATTR_COLUMNS: AttrColumn[] = [
  { code: "Ri", tone: "rise", kinds: ["rise"] },
  { code: "Bo", tone: "position", kinds: ["position", "bodyActions"] },
  { code: "Fw", tone: "footwork", kinds: ["footwork"] },
  { code: "Sw", tone: "sway", kinds: ["sway"] },
  { code: "Tn", tone: "turn", kinds: ["turn"] },
];

/** Kinds that own a column (so other kinds can be detected as "extra"). */
export const COLUMN_KINDS = new Set<string>(ATTR_COLUMNS.flatMap((c) => c.kinds));

/** Short cell codes per kind value — chosen to fit the design's tight columns. */
const ABBREV: Record<string, Record<string, string>> = {
  rise: {
    commence: "com",
    body_rise: "BR",
    foot_rise: "FR",
    up: "up",
    continue: "cont",
    lowering: "low",
    NFR: "NFR",
  },
  position: { closed: "Cl", promenade: "PP", wing: "W", CBMP: "CBMP" },
  footwork: {
    // Canonical picker codes → tight overview codes (explicit so no fallback
    // mangles the slashed rolls). The full descriptive label lives in the edit
    // picker; the explanation in the registry valueDefs.
    HT: "HT",
    TH: "TH",
    T: "T",
    H: "H",
    B: "B",
    WF: "WF",
    BF: "BF",
    IE: "IE",
    flat: "F",
    "heel turn": "Htn",
    "heel pull": "HP",
    // Compound rolls carried by the catalog.
    BH: "BH",
    HTH: "HTH",
    THT: "THT",
    "T/H/T": "T/H/T",
    "H/T": "H/T",
    "T/H": "T/H",
    "T/TH": "T/TH",
    "TH/T": "TH/T",
    // Legacy anatomical tokens still render for old data.
    ball: "B",
    ball_flat: "BF",
    heel: "H",
    heel_ball: "HB",
    toe: "T",
    tap: "tap",
  },
  // CBMP moved to `position`; the legacy bodyActions abbrev stays for old data.
  bodyActions: { CBM: "CB", CBMP: "CBP" },
  sway: { to_L: "L", to_R: "R", none: "–" },
  turn: {
    none: "–",
    eighth_L: "⅛L",
    eighth_R: "⅛R",
    quarter_L: "¼L",
    quarter_R: "¼R",
    three_eighth_L: "⅜L",
    three_eighth_R: "⅜R",
    half_L: "½L",
    half_R: "½R",
    five_eighth_L: "⅝L",
    five_eighth_R: "⅝R",
    three_quarter_L: "¾L",
    three_quarter_R: "¾R",
    seven_eighth_L: "⅞L",
    seven_eighth_R: "⅞R",
    full_L: "1L",
    full_R: "1R",
  },
};

/** Readable direction labels for the step headline. */
const DIRECTION_LABEL: Record<string, string> = {
  forward: "forward",
  back: "back",
  side: "side",
  behind: "behind",
  close: "close",
  diagonal: "diagonal",
  in_place: "in place",
  // Legacy split-diagonal values (normalize to `diagonal` on read; kept so an
  // un-normalized legacy value still renders sensibly).
  diag_forward: "diagonal",
  diag_back: "diagonal",
};

/**
 * Full descriptive label per value, shown in the EDIT picker (the reading overview
 * uses the tight ABBREV codes instead). A value with no entry falls back to the raw
 * value humanized — so custom kinds and any un-mapped value still read sensibly.
 * The one-line EXPLANATION lives in the registry `valueDefs` (info overlay + the
 * editor's inline note); this is just the chip's headline.
 */
const FULL_LABEL: Record<string, Record<string, string>> = {
  direction: {
    forward: "Forward",
    back: "Back",
    side: "Side",
    behind: "Behind",
    close: "Close",
    diagonal: "Diagonal",
    in_place: "In place",
  },
  footwork: {
    HT: "Heel-Toe",
    TH: "Toe-Heel",
    T: "Toe",
    H: "Heel",
    B: "Ball",
    WF: "Whole foot",
    BF: "Ball-flat",
    IE: "Inside edge",
    flat: "Flat foot",
    "heel turn": "Heel turn",
    "heel pull": "Heel pull",
    BH: "Ball-heel",
    HTH: "Heel-Toe-Heel",
    THT: "Toe-Heel-Toe",
    "T/H/T": "Toe / Heel / Toe",
    "H/T": "Heel / Toe",
    "T/H": "Toe / Heel",
    "T/TH": "Toe / Toe-Heel",
    "TH/T": "Toe-Heel / Toe",
  },
  footPosition: {
    first: "First",
    second: "Second",
    third: "Third",
    fourth_open: "Fourth (open)",
    fourth_closed: "Fourth (closed)",
    fifth: "Fifth",
  },
  rise: {
    commence: "Commence",
    body_rise: "Body rise",
    foot_rise: "Foot rise",
    up: "Up",
    continue: "Continue",
    lowering: "Lowering",
    NFR: "No foot rise",
  },
  position: {
    closed: "Closed",
    promenade: "Promenade",
    counter_promenade: "Counter promenade",
    outside_partner: "Outside partner",
    left_side: "Left side",
    right_side: "Right side",
    tandem: "Tandem",
    wing: "Wing",
    CBMP: "CBMP",
  },
  bodyActions: { CBM: "CBM", side_leading: "Side leading" },
  sway: { to_L: "Sway left", to_R: "Sway right", none: "No sway" },
  turn: {
    none: "No turn",
    eighth_L: "⅛ left",
    eighth_R: "⅛ right",
    quarter_L: "¼ left",
    quarter_R: "¼ right",
    three_eighth_L: "⅜ left",
    three_eighth_R: "⅜ right",
    half_L: "½ left",
    half_R: "½ right",
    five_eighth_L: "⅝ left",
    five_eighth_R: "⅝ right",
    three_quarter_L: "¾ left",
    three_quarter_R: "¾ right",
    seven_eighth_L: "⅞ left",
    seven_eighth_R: "⅞ right",
    full_L: "Full turn left",
    full_R: "Full turn right",
  },
};

/** The full descriptive label for a value (the edit picker), or the humanized raw
 *  value when unmapped (custom kinds, future values). */
export function labelValue(kind: string, value: unknown): string {
  const raw = String(value);
  return FULL_LABEL[kind]?.[raw] ?? raw.replace(/_/g, " ");
}

/** A short, column-friendly code for one attribute value. Falls back to a
 *  trimmed, space-normalized prefix for custom/unknown values. */
export function abbrevValue(kind: string, value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => ABBREV[kind]?.[String(v)] ?? shortFallback(String(v))).join(",");
  }
  const raw = String(value);
  return ABBREV[kind]?.[raw] ?? shortFallback(raw);
}

/** Generic compaction for values with no explicit code (custom/free-text). */
function shortFallback(value: string): string {
  const cleaned = value.replace(/_/g, " ");
  return cleaned.length <= 4 ? cleaned : cleaned.slice(0, 3);
}

/** A compact one-word tag for a kind's chip in the editor lane ("Rise & Fall"
 *  → "Rise", "Body Actions" → "Body"). */
export function shortKindLabel(label: string): string {
  return label.split(" ")[0] ?? label;
}

/** The readable label for a `direction` value (the step headline body). */
export function humanizeDirection(value: unknown): string {
  const raw = String(value);
  return DIRECTION_LABEL[raw] ?? raw.replace(/_/g, " ");
}

/** The step headline — the (humanized) direction, e.g. "forward". An em dash
 *  when the step has no direction yet. (Foot is intentionally NOT shown: it
 *  isn't modelled and the design's "RF/LF" prefix was a mistake.) */
export function stepAction(direction: unknown | undefined): string {
  if (direction == null || direction === "") return "—";
  return humanizeDirection(direction);
}
