// Reading-view column model (design frames 1.6). A figure's notation is laid
// out as a per-figure table whose columns are ONLY the attribute kinds that
// figure actually uses — the "Step" column merges the step's direction +
// footwork into one blue chip (e.g. "fwd·HT"), and the remaining technique
// kinds (Rise · Pos · Sway · Turn · custom) each get their own kind-colored
// column. `direction`/`footwork` never get their own column — they always feed
// the merged Step chip. Pure presentation helpers over the store's Attribute
// reads (no I/O), shared by RoutineReadingView so the column logic is testable
// in isolation.
import {
  type Attribute,
  type DanceId,
  kindAppliesToDance,
  mergeRegistry,
  type RegistryKind,
} from "@weavesteps/domain";
import { getLocale, type Locale, localizedRegistry } from "../i18n";
import type { AttributeKind } from "../ui";
import { abbrevValue } from "./attribute-display";
import type { RoleView } from "./role-view";

/** The kind ids that have a `--bf-kind-*` token color family for column headers /
 *  chips. A deliberate SUBSET of the standard kinds (rotation/head aren't shown as
 *  columns), so it's its own list rather than reusing ATTRIBUTE_KINDS. */
export const STANDARD_COLUMN_KINDS: readonly AttributeKind[] = [
  "direction",
  "footwork",
  "footPosition",
  "rise",
  "position",
  "bodyActions",
  "sway",
  "turn",
];

/** Runtime narrowing to a token-colored column kind — lets `kindVar(col.kind)` be
 *  called without asserting `col.kind` (which may be a custom kind) is standard. */
export function isColumnKind(kind: string): kind is AttributeKind {
  return STANDARD_COLUMN_KINDS.some((k) => k === kind);
}

export type { RoleView };

/** Compact direction codes for the merged Step chip (forward → "fwd"), per
 *  locale — German uses the customary vw/rw shorthand. */
const DIRECTION_ABBREV_EN = {
  forward: "fwd",
  back: "back",
  side: "side",
  behind: "beh",
  close: "close",
  in_front: "front",
  diagonal: "diag",
  in_place: "in pl",
  // Legacy split-diagonal values (normalize to `diagonal` on read).
  diag_forward: "diag",
  diag_back: "diag",
};
const DIRECTION_ABBREV_DE: typeof DIRECTION_ABBREV_EN = {
  forward: "vw",
  back: "rw",
  side: "seit",
  behind: "hint",
  close: "schl",
  in_front: "vorkr",
  diagonal: "diag",
  in_place: "Platz",
  diag_forward: "diag",
  diag_back: "diag",
};
const DIRECTION_ABBREV: Record<Locale, Record<string, string>> = {
  en: DIRECTION_ABBREV_EN,
  de: DIRECTION_ABBREV_DE,
};

/** A short, chip-friendly code for a `direction` value. */
export function directionAbbrev(value: unknown): string {
  const raw = String(value);
  return DIRECTION_ABBREV[getLocale()][raw] ?? raw.replace(/_/g, " ").slice(0, 5);
}

/**
 * Merge a step's direction + footwork into the single blue Step chip label
 * (frame 1.6: "fwd·HT", "side·T", "close·TH"). Returns null when the step has
 * neither (an attribute can sit on its own timing with no Step — the Step cell
 * then shows the empty dot).
 */
export function stepChipLabel(direction: unknown, footwork: unknown): string | null {
  const dir = direction == null || direction === "" ? null : directionAbbrev(direction);
  const fw = footwork == null || footwork === "" ? null : abbrevValue("footwork", footwork);
  if (dir && fw) return `${dir}·${fw}`;
  return dir ?? fw ?? null;
}

/** One column in a figure's reading table. */
export interface ReadingColumn {
  /** "step" for the merged Step column, else the attribute kind id. */
  id: string;
  /** Header label (frame: Step · Rise · Pos · Sway · Turn). */
  label: string;
  /** Attribute kind id that drives the column's color (direction for Step). */
  kind: string;
  /** The merged direction+footwork Step column. */
  isStep?: boolean;
}

/** Header label per standard kind (the design's abbreviated column heads),
 *  per locale. The merged first column's head lives in STEP_LABEL below. */
const COLUMN_LABEL: Record<Locale, Record<string, string>> = {
  en: {
    rise: "Rise",
    position: "Pos",
    footPosition: "Feet",
    sway: "Sway",
    turn: "Turn",
    bodyActions: "Body",
    rotation: "Rot",
    head: "Head",
  },
  de: {
    rise: "Heben",
    position: "Pos",
    footPosition: "Füße",
    sway: "Neig",
    turn: "Dreh",
    bodyActions: "Körper",
    rotation: "Rot",
    head: "Kopf",
  },
};

/** The merged direction+footwork column's header, per locale. */
const STEP_LABEL: Record<Locale, string> = { en: "Step", de: "Schritt" };

/** Technique kinds that get a column, in the design's left-to-right order
 *  (Rise · Pos · Feet · Body · Sway · Turn). */
const ORDERED_KINDS = [
  "rise",
  "position",
  "footPosition",
  "bodyActions",
  "sway",
  "turn",
  "rotation",
  "head",
];

/** Kinds that never get their own column (they feed the merged Step chip). */
const STEP_KINDS = new Set(["direction", "footwork"]);

function titleCase(kind: string): string {
  const s = kind.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The ordered set of columns a figure actually uses (frame 1.6: "only what's
 * set"). Always leads with the merged "Step" column when the figure has any
 * direction/footwork, then each standard technique kind that has ≥1 live value
 * AND applies to the dance (Tango omits Rise), then any custom kinds (e.g. a
 * user-defined "Head") in first-seen order.
 */
export function usedColumns(attrs: Attribute[], dance?: DanceId): ReadingColumn[] {
  const locale = getLocale();
  const labels = COLUMN_LABEL[locale];
  const live = attrs.filter((a) => a.deletedAt == null);
  const present = new Set(live.map((a) => a.kind));
  const cols: ReadingColumn[] = [];
  if (present.has("direction") || present.has("footwork")) {
    cols.push({ id: "step", label: STEP_LABEL[locale], kind: "direction", isStep: true });
  }
  for (const k of ORDERED_KINDS) {
    if (present.has(k) && kindAppliesToDance(k, dance)) {
      cols.push({ id: k, label: labels[k] ?? titleCase(k), kind: k });
    }
  }
  const known = new Set([...STEP_KINDS, ...ORDERED_KINDS]);
  // Custom / non-standard kinds, in stable first-seen order.
  for (const a of live) {
    if (!known.has(a.kind) && !cols.some((c) => c.id === a.kind)) {
      cols.push({ id: a.kind, label: labels[a.kind] ?? titleCase(a.kind), kind: a.kind });
    }
  }
  return cols;
}

/** The technique kinds the EDIT grid offers a column for, in left-to-right
 *  order (frame 1.11). Unlike the reading view (only-used), the edit grid shows
 *  EVERY applicable kind so empty cells are addable; `bodyActions` rides the
 *  "Body" column alongside `position` is NOT done here — each kind is its own
 *  column so a cell maps 1:1 to a (count, kind) editor target. */
const EDIT_ORDERED_KINDS = [
  "rise",
  "position",
  "footPosition",
  "bodyActions",
  "sway",
  "turn",
  "rotation",
  "head",
];

/**
 * Every column the EDIT grid should show for a figure's dance (frame 1.11:
 * "EDIT grid · every type"). Always leads with the merged Step column, then each
 * standard technique kind that APPLIES to the dance (Tango omits Rise), then any
 * user-defined custom kinds (in registry order) applicable to the dance. This is
 * the all-applicable counterpart to `usedColumns` (only-used, reading view): the
 * edit grid renders empty cells so a value can be added to any applicable kind.
 */
export function allColumns(dance?: DanceId, customKinds: RegistryKind[] = []): ReadingColumn[] {
  const locale = getLocale();
  const labels = COLUMN_LABEL[locale];
  const reg = mergeRegistry(localizedRegistry(getLocale()), customKinds);
  const cols: ReadingColumn[] = [
    { id: "step", label: STEP_LABEL[locale], kind: "direction", isStep: true },
  ];
  for (const k of EDIT_ORDERED_KINDS) {
    if (kindAppliesToDance(k, dance)) {
      cols.push({ id: k, label: labels[k] ?? titleCase(k), kind: k });
    }
  }
  // Custom (non-builtin) kinds, in stable registry order, honoring appliesToDances.
  for (const k of Object.values(reg)) {
    if (k.builtin || STEP_KINDS.has(k.kind) || EDIT_ORDERED_KINDS.includes(k.kind)) continue;
    if (k.appliesToDances && dance !== undefined && !k.appliesToDances.includes(dance)) continue;
    if (cols.some((c) => c.id === k.kind)) continue;
    cols.push({ id: k.kind, label: labels[k.kind] ?? k.label, kind: k.kind });
  }
  return cols;
}

/** The cell value (chip label) for `column` at one count's attributes, or null
 *  for an empty slot (renders the faint dot). The Step column merges the count's
 *  direction + footwork. */
export function cellValue(here: Attribute[], column: ReadingColumn): string | null {
  if (column.isStep) {
    const direction = here.find((a) => a.kind === "direction")?.value;
    const footwork = here.find((a) => a.kind === "footwork")?.value;
    return stepChipLabel(direction, footwork);
  }
  const a = here.find((x) => x.kind === column.kind);
  // A PRESENCE attribute (value: null/empty — Builder v3 ②) has no chip label:
  // the edit grid renders its dashed ring, the reading view its empty dot.
  return a && hasAttrValue(a.value) ? abbrevValue(column.kind, a.value) : null;
}

/** Whether an attribute actually carries a value (vs a presence-only `null`/
 *  empty write — Builder v3 ②). */
export function hasAttrValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/** True when a count sits off the beat (a fractional sub-beat — &, a, e, …);
 *  those rows render dimmed (frame 1.6). */
export function isOffBeatCount(count: number): boolean {
  return !Number.isInteger(count);
}

/**
 * The registry kind(s) an attribute info sheet (frame 1.13) should describe when
 * a column's value chip or header is tapped. The merged Step column holds two
 * kinds — direction + footwork — so it resolves to BOTH (rendered as two sections
 * in the sheet); every other column resolves to its single kind.
 *
 * Always returns ≥1 kind: a custom attribute with no registry entry (e.g. one
 * authored elsewhere and not in `customKinds`) is SYNTHESIZED from the values
 * observed on the figure, so the overlay still shows the value list even when no
 * prose/definitions exist for it (the "even custom attributes get a short view +
 * a longer selection" requirement).
 */
export function infoKindsForColumn(
  col: ReadingColumn,
  customKinds: RegistryKind[],
  live: Attribute[],
): RegistryKind[] {
  const reg = mergeRegistry(localizedRegistry(getLocale()), customKinds);
  const wanted = col.isStep ? ["direction", "footwork"] : [col.kind];
  return wanted.map((kid) => {
    const found = reg[kid];
    if (found) return found;
    const observed = [
      ...new Set(
        live.filter((a) => a.deletedAt == null && a.kind === kid).map((a) => String(a.value)),
      ),
    ];
    return {
      kind: kid,
      label: col.label,
      color: "var(--bf-ink-secondary)",
      cardinality: "multi",
      valueType: "text",
      values: observed,
      builtin: false,
    } satisfies RegistryKind;
  });
}

/** How many distinct steps (counts) of a figure carry any of `kinds` — the info
 *  sheet's "Used in N steps" footer (frame 1.13). */
export function columnUsage(live: Attribute[], kinds: RegistryKind[]): number {
  const ids = new Set(kinds.map((k) => k.kind));
  return new Set(live.filter((a) => a.deletedAt == null && ids.has(a.kind)).map((a) => a.count))
    .size;
}
