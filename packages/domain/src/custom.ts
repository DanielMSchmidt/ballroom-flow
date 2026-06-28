// @ballroom/domain — derive whether a routine figure is "custom" by diffing it against its
// library default. This replaces an add-time `source` flag (design §2.1 lists `isCustom` as
// *derived*) with the owner-specified rule:
//
//   • Add a library figure and leave it alone        → PRISTINE  → not custom.
//   • Change an attribute the default already set     → MODIFIED  → custom (the badge appears).
//   • Add an attribute the default did not have, OR
//     add/remove a step                               → FORKED    → custom (an implicit fork).
//   • Compose a figure from scratch (no library link) → FORKED    → custom.
//
// "Configured" means the library default supplied a non-empty value for that attribute. So
// editing the footwork every catalog figure ships with is a modification, while filling in a
// sway that was blank is an addition — exactly the distinction the owner drew.

import type { FigureInstance, LibraryFigure, Step } from "./figures";
import { getLibraryFigure } from "./figures";
import { SLOT_REGISTRY, type SlotDef } from "./vocabulary";

export type CustomState = "pristine" | "modified" | "forked";

/** A figure-level field name, or `role[index].slot` for a per-step technique attribute. */
export interface AttributeRef {
  role?: "leader" | "follower";
  stepIndex?: number;
  attribute: string;
}

export interface AttributeChange extends AttributeRef {
  before: unknown;
  after: unknown;
}

export interface FigureCustomState {
  state: CustomState;
  /** True for `modified` or `forked` — i.e. anything that diverges from the catalog default. */
  isCustom: boolean;
  /** True for `forked` — a new attribute/step was added (the "implicit fork" case). */
  isFork: boolean;
  /** Existing configured attributes whose value differs from the default. */
  changes: AttributeChange[];
  /** Attributes/steps present on the instance but not configured in the default. */
  additions: AttributeChange[];
}

const PRISTINE: FigureCustomState = {
  state: "pristine",
  isCustom: false,
  isFork: false,
  changes: [],
  additions: [],
};

function isConfigured(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.length > 0;
  return true;
}

/** Order-independent equality for the registry value types (scalars + multi-select sets). */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const sa = [...(Array.isArray(a) ? a : [])].sort();
    const sb = [...(Array.isArray(b) ? b : [])].sort();
    return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

const slotOf = (step: Step, slot: SlotDef): unknown =>
  (step as unknown as Record<string, unknown>)[slot.key];

/** Diff one role's chart, pushing into `changes` (existing attr changed) / `additions` (new). */
function diffChart(
  role: "leader" | "follower",
  defaults: Step[],
  instance: Step[],
  changes: AttributeChange[],
  additions: AttributeChange[],
): void {
  for (let i = 0; i < instance.length; i++) {
    const inst = instance[i];
    if (!inst) continue;
    const def = defaults[i];

    // A step beyond the default's length is an added step → fork.
    if (!def) {
      additions.push({ role, stepIndex: i, attribute: "step", before: undefined, after: inst });
      continue;
    }

    // `action` and `timing` are always configured on a library step; treat as existing attrs.
    if (inst.action !== def.action) {
      changes.push({
        role,
        stepIndex: i,
        attribute: "action",
        before: def.action,
        after: inst.action,
      });
    }
    if (!valuesEqual(inst.timing, def.timing)) {
      changes.push({
        role,
        stepIndex: i,
        attribute: "timing",
        before: def.timing,
        after: inst.timing,
      });
    }

    for (const slot of SLOT_REGISTRY) {
      const before = slotOf(def, slot);
      const after = slotOf(inst, slot);
      if (valuesEqual(before, after)) continue;
      const ref = { role, stepIndex: i, attribute: slot.key, before, after };
      // Default had a value here → this is a change to a configured attribute.
      // Default was blank and the instance now sets one → a newly added attribute → fork.
      (isConfigured(before) ? changes : additions).push(ref);
    }
  }

  // Steps the default had but the instance dropped are structural changes (not additions).
  for (let i = instance.length; i < defaults.length; i++) {
    const def = defaults[i];
    if (!def) continue;
    changes.push({ role, stepIndex: i, attribute: "step", before: def, after: undefined });
  }
}

function diffFigureField(
  attribute: string,
  before: unknown,
  after: unknown,
  changes: AttributeChange[],
  additions: AttributeChange[],
): void {
  if (valuesEqual(before, after)) return;
  (isConfigured(before) ? changes : additions).push({ attribute, before, after });
}

function classify(changes: AttributeChange[], additions: AttributeChange[]): FigureCustomState {
  // Any addition makes it a fork (the stronger state), even alongside changes.
  if (additions.length > 0)
    return { state: "forked", isCustom: true, isFork: true, changes, additions };
  if (changes.length > 0)
    return { state: "modified", isCustom: true, isFork: false, changes, additions };
  return PRISTINE;
}

/**
 * Derive the custom state of a routine figure against its library default.
 *
 * @param figure   the figure as it lives in the routine.
 * @param library  the catalog default; if omitted it is looked up by `figure.libraryFigureId`.
 *                 A figure with no library link (composed from scratch) is always a fork.
 */
export function deriveFigureCustomState(
  figure: FigureInstance,
  library?: LibraryFigure,
): FigureCustomState {
  const def =
    library ?? (figure.libraryFigureId ? getLibraryFigure(figure.libraryFigureId) : undefined);

  // No default to compare against: a from-scratch (or orphaned) figure is its own thing.
  if (!def) {
    return {
      state: "forked",
      isCustom: true,
      isFork: true,
      changes: [],
      additions: [{ attribute: "figure", before: undefined, after: figure.id }],
    };
  }

  const changes: AttributeChange[] = [];
  const additions: AttributeChange[] = [];

  diffFigureField("name", def.name, figure.name, changes, additions);
  diffFigureField(
    "entryAlignment",
    def.entryAlignment ?? null,
    figure.entryAlignment ?? null,
    changes,
    additions,
  );
  diffFigureField(
    "exitAlignment",
    def.exitAlignment ?? null,
    figure.exitAlignment ?? null,
    changes,
    additions,
  );

  diffChart("leader", def.leaderSteps, figure.leaderSteps, changes, additions);
  diffChart("follower", def.followerSteps, figure.followerSteps, changes, additions);

  return classify(changes, additions);
}

/** Convenience boolean: does this figure read as custom? */
export function isFigureCustom(figure: FigureInstance, library?: LibraryFigure): boolean {
  return deriveFigureCustomState(figure, library).isCustom;
}
