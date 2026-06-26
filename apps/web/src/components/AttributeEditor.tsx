// US-028 / US-029 — the attribute editor for ONE count on a figure timeline.
//
// Registry-driven (US-003): the sections + value options render from the merged
// ATTRIBUTE_REGISTRY — attribute kinds are DATA, not code. Single-cardinality
// kinds (rise/position) keep one value; multi kinds (step/bodyActions) hold a
// set. Re-tapping a selected value CLEARS it (US-028 AC-2). Editing is
// editor-only (AC-4): a commenter/viewer sees the values as static chips with no
// toggle. Dance scoping (Tango hides rise) is US-029; honored here via
// appliesToDances so it's correct from the start.
//
// Controlled: `value` is this count's current attributes; every edit emits the
// next attribute set via `onChange`. The screen wires `onChange` to the store's
// setAttribute mutation; component tests pass it directly.
import { ATTRIBUTE_REGISTRY, type Attribute, type DanceId, normalizeValue } from "@ballroom/domain";
import { Chip } from "../ui";
import type { MembershipRole } from "./Assemble";

export interface AttributeEditorProps {
  /** The float count these attributes sit on. */
  count: number;
  /** Membership role — only an editor can toggle values (AC-4). */
  role: MembershipRole;
  /** The dance, to scope the registry (e.g. Tango omits rise — US-029). */
  dance?: DanceId;
  /** The viewed role lens (leader/follower/both); new values inherit it. */
  view?: "leader" | "follower" | null;
  /** This count's current attributes (controlled). */
  value?: Attribute[];
  /** Emits the next attribute set for this count after an edit. */
  onChange?: (next: Attribute[]) => void;
}

/** Registry kinds that apply to `dance` (drops e.g. rise for Tango). */
function kindsFor(dance: DanceId | undefined) {
  return Object.values(ATTRIBUTE_REGISTRY).filter(
    (k) => !k.appliesToDances || dance === undefined || k.appliesToDances.includes(dance),
  );
}

export function AttributeEditor({
  count,
  role,
  dance,
  view = null,
  value = [],
  onChange,
}: AttributeEditorProps) {
  const editable = role === "editor";
  const live = value.filter((a) => a.deletedAt == null);
  const selected = (kind: string, v: string): boolean =>
    live.some((a) => a.kind === kind && normalizeValue(kind, String(a.value)) === v);

  /** Toggle one value of a kind, honoring its cardinality, and emit the result. */
  const toggle = (kind: string, cardinality: "single" | "multi", raw: string): void => {
    if (!editable || !onChange) return;
    const v = normalizeValue(kind, raw);
    const isOn = selected(kind, v);
    let next: Attribute[];
    if (isOn) {
      // Re-tap clears this value (US-028 AC-2).
      next = live.filter((a) => !(a.kind === kind && normalizeValue(kind, String(a.value)) === v));
    } else if (cardinality === "single") {
      // Single: replace any existing value of this kind at this count.
      next = [
        ...live.filter((a) => a.kind !== kind),
        { id: `${kind}-${count}-${v}`, kind, count, value: v, role: view, deletedAt: null },
      ];
    } else {
      // Multi: add to the set.
      next = [
        ...live,
        { id: `${kind}-${count}-${v}`, kind, count, value: v, role: view, deletedAt: null },
      ];
    }
    onChange(next);
  };

  return (
    <section className="flex flex-col gap-3" aria-label={`Attributes for count ${count}`}>
      {kindsFor(dance).map((kind) => (
        // A <fieldset> is implicitly role="group"; the <legend> is its name —
        // so `getByRole("group", { name })` resolves per kind (US-029).
        <fieldset key={kind.kind} className="flex flex-wrap items-center gap-1">
          <legend className="mb-1 text-2xs font-bold text-ink-faint">{kind.label}</legend>
          {(kind.values ?? []).map((v) => {
            const on = selected(kind.kind, v);
            if (!editable) {
              // Read-only: show only the selected values, as static chips.
              return on ? (
                <Chip key={v} tone="neutral" asStatic>
                  {v}
                </Chip>
              ) : null;
            }
            return (
              <Chip
                key={v}
                tone="neutral"
                selected={on}
                onClick={() => toggle(kind.kind, kind.cardinality, v)}
              >
                {v}
              </Chip>
            );
          })}
        </fieldset>
      ))}
    </section>
  );
}
