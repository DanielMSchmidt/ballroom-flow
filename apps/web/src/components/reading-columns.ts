// Reading-view column model (design frames 1.6). A figure's notation is laid
// out as a per-figure table whose columns are ONLY the attribute kinds that
// figure actually uses — the "Step" column merges the step's direction +
// footwork into one blue chip (e.g. "fwd·HT"), and the remaining technique
// kinds (Rise · Pos · Sway · Turn · custom) each get their own kind-colored
// column. `direction`/`footwork` never get their own column — they always feed
// the merged Step chip. Pure presentation helpers over the store's Attribute
// reads (no I/O), shared by RoutineReadingView so the column logic is testable
// in isolation.
import { ATTRIBUTE_REGISTRY, type Attribute, type DanceId } from "@ballroom/domain";
import { abbrevValue } from "./attribute-display";
import type { RoleView } from "./role-view";

export type { RoleView };

/** Compact direction codes for the merged Step chip (forward → "fwd"). */
const DIRECTION_ABBREV: Record<string, string> = {
  forward: "fwd",
  back: "back",
  side: "side",
  close: "close",
  diag_forward: "diag↗",
  diag_back: "diag↘",
  in_place: "in pl",
};

/** A short, chip-friendly code for a `direction` value. */
export function directionAbbrev(value: unknown): string {
  const raw = String(value);
  return DIRECTION_ABBREV[raw] ?? raw.replace(/_/g, " ").slice(0, 5);
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

/** Header label per standard kind (the design's abbreviated column heads). */
const COLUMN_LABEL: Record<string, string> = {
  rise: "Rise",
  position: "Pos",
  sway: "Sway",
  turn: "Turn",
  bodyActions: "Body",
};

/** Technique kinds that get a column, in the design's left-to-right order. */
const ORDERED_KINDS = ["rise", "position", "sway", "turn"];

/** Kinds that never get their own column (they feed the merged Step chip). */
const STEP_KINDS = new Set(["direction", "footwork"]);

function titleCase(kind: string): string {
  const s = kind.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Whether a builtin kind applies to a dance (e.g. `rise` omits Tango via the
 *  registry's `appliesToDances`). The write path does NOT strictly enforce this
 *  (`setFigureAttributes` stores attributes unvalidated — the dance gate is a UI
 *  affordance in AttributeEditor/FigureTimeline), so the reading view defends
 *  against a stray value (e.g. a rise persisted onto a Tango figure) by hiding
 *  the inapplicable column. */
function kindAppliesToDance(kind: string, dance: DanceId | undefined): boolean {
  if (dance === undefined) return true;
  const reg = (ATTRIBUTE_REGISTRY as Record<string, { appliesToDances?: DanceId[] }>)[kind];
  return !reg?.appliesToDances || reg.appliesToDances.includes(dance);
}

/**
 * The ordered set of columns a figure actually uses (frame 1.6: "only what's
 * set"). Always leads with the merged "Step" column when the figure has any
 * direction/footwork, then each standard technique kind that has ≥1 live value
 * AND applies to the dance (Tango omits Rise), then any custom kinds (e.g. a
 * user-defined "Head") in first-seen order.
 */
export function usedColumns(attrs: Attribute[], dance?: DanceId): ReadingColumn[] {
  const live = attrs.filter((a) => a.deletedAt == null);
  const present = new Set(live.map((a) => a.kind));
  const cols: ReadingColumn[] = [];
  if (present.has("direction") || present.has("footwork")) {
    cols.push({ id: "step", label: "Step", kind: "direction", isStep: true });
  }
  for (const k of ORDERED_KINDS) {
    if (present.has(k) && kindAppliesToDance(k, dance)) {
      cols.push({ id: k, label: COLUMN_LABEL[k] ?? titleCase(k), kind: k });
    }
  }
  const known = new Set([...STEP_KINDS, ...ORDERED_KINDS]);
  // Custom / non-standard kinds, in stable first-seen order.
  for (const a of live) {
    if (!known.has(a.kind) && !cols.some((c) => c.id === a.kind)) {
      cols.push({ id: a.kind, label: COLUMN_LABEL[a.kind] ?? titleCase(a.kind), kind: a.kind });
    }
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
  return a ? abbrevValue(column.kind, a.value) : null;
}

/** True when a count sits off the beat (a fractional sub-beat — &, a, e, …);
 *  those rows render dimmed (frame 1.6). */
export function isOffBeatCount(count: number): boolean {
  return !Number.isInteger(count);
}
