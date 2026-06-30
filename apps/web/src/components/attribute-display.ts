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
  position: { closed: "Cl", promenade: "PP", wing: "W", CBMP: "CBP" },
  footwork: {
    // Canonical picker codes (already short — explicit so no fallback mangles them).
    HT: "HT",
    T: "T",
    TH: "TH",
    H: "H",
    "heel pull": "HP",
    // Legacy anatomical tokens still render for old data.
    ball: "B",
    ball_flat: "BF",
    flat: "F",
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
