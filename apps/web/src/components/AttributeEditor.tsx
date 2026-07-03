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
import {
  type Attribute,
  type DanceId,
  mergeRegistry,
  normalizeValue,
  type RegistryKind,
  type StandardRegistry,
} from "@ballroom/domain";
import { type FormEvent, type ReactNode, useState } from "react";
import { useLocalizedRegistry, useMessages } from "../i18n";
import { attributesMessages } from "../i18n/messages/attributes";
import { Button, Chip, IconButton, InfoIcon, Input, SegmentedToggle } from "../ui";
import type { MembershipRole } from "./Assemble";
import { AttributeInfoSheet } from "./AttributeInfoSheet";
import { labelValue } from "./attribute-display";

/** The role a value is written to: null = both, else a single side. */
type RoleScope = "leader" | "follower" | null;
type RolesMode = "both" | "perRole";

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
  /** User-defined kinds to merge into the registry (US-043). */
  customKinds?: RegistryKind[];
  /** Start with the technique section ("More attributes") expanded — set when
   *  opened from a ghost add-chip for a non-identity kind. */
  defaultExpanded?: boolean;
  /** The whole figure's attributes — used to count "Used in N steps" in the info
   *  sheet (frame 1.13). Defaults to just this count's `value`. */
  figureAttributes?: Attribute[];
  /** The choreo/figure name for the info sheet's "across …" footer. */
  scopeLabel?: string;
  /**
   * Focus the editor on ONE column's kind(s) — the single-attribute overlay (frame
   * 1.12): render only these kinds (always expanded, no "More attributes"
   * disclosure), and scope Remove to them. Omitted → the full per-count editor.
   */
  onlyKinds?: string[];
  /** When set, render a Save button (confirm + close) — the overlay's per-attribute
   *  confirm. Edits already auto-save via `onChange`; Save just dismisses. */
  onDone?: () => void;
  /** Emits the next attribute set for this count after an edit. */
  onChange?: (next: Attribute[]) => void;
}

/** Registry kinds that apply to `dance` (drops e.g. rise for Tango). */
function kindsFor(base: StandardRegistry, dance: DanceId | undefined, customKinds: RegistryKind[]) {
  const reg = mergeRegistry(base, customKinds);
  return Object.values(reg).filter(
    (k) => !k.appliesToDances || dance === undefined || k.appliesToDances.includes(dance),
  );
}

export function AttributeEditor({
  count,
  role,
  dance,
  value = [],
  customKinds = [],
  defaultExpanded = false,
  figureAttributes,
  scopeLabel,
  onlyKinds,
  onDone,
  onChange,
}: AttributeEditorProps) {
  const t = useMessages(attributesMessages);
  const editable = role === "editor";
  const focused = onlyKinds != null;
  const [showMore, setShowMore] = useState(defaultExpanded);
  // The kind whose info reference is open (frame 1.13), or null.
  const [infoKind, setInfoKind] = useState<RegistryKind | null>(null);
  const live = value.filter((a) => a.deletedAt == null);
  // ROLES toggle (frame 1.12): "Same for both" writes role=null (one set applies
  // to both); "Per role" splits into Leader + Follower rails, each writing its own
  // role-scoped values. Default to Per role when the count already carries any
  // role-scoped value, so re-opening reflects the stored shape.
  const [rolesMode, setRolesMode] = useState<RolesMode>(() =>
    live.some((a) => a.role != null) ? "perRole" : "both",
  );
  // "Used in N steps": distinct counts that carry a (live) value of this kind,
  // across the whole figure when provided (else just this count's value).
  const usageFor = (k: string): number => {
    const source = figureAttributes ?? value;
    return new Set(source.filter((a) => a.deletedAt == null && a.kind === k).map((a) => a.count))
      .size;
  };
  // Whether a (kind, value) is selected within a role scope. `"any"` matches any
  // role — used for the read-only render so a viewer sees every set value.
  const selected = (kind: string, v: string, scope: RoleScope | "any"): boolean =>
    live.some(
      (a) =>
        a.kind === kind &&
        normalizeValue(kind, String(a.value)) === v &&
        (scope === "any" || (a.role ?? null) === scope),
    );

  /** Toggle one value of a kind within a role scope, honoring cardinality. */
  const toggle = (
    kind: string,
    cardinality: "single" | "multi",
    raw: string,
    scope: RoleScope,
  ): void => {
    if (!editable || !onChange) return;
    const v = normalizeValue(kind, raw);
    const isOn = selected(kind, v, scope);
    const sameSlot = (a: Attribute) => a.kind === kind && (a.role ?? null) === scope;
    let next: Attribute[];
    if (isOn) {
      // Re-tap clears this value (US-028 AC-2).
      next = live.filter((a) => !(sameSlot(a) && normalizeValue(kind, String(a.value)) === v));
    } else if (cardinality === "single") {
      // Single: replace any existing value of this kind in this role scope.
      next = [
        ...live.filter((a) => !sameSlot(a)),
        {
          id: `${kind}-${count}-${v}-${scope ?? "both"}`,
          kind,
          count,
          value: v,
          role: scope,
          deletedAt: null,
        },
      ];
    } else {
      // Multi: add to the set.
      next = [
        ...live,
        {
          id: `${kind}-${count}-${v}-${scope ?? "both"}`,
          kind,
          count,
          value: v,
          role: scope,
          deletedAt: null,
        },
      ];
    }
    onChange(next);
  };

  /** Clear this count's values for the active role scope(s) — the red "remove
   *  attribute" action (frame 1.12). Same-for-both clears the both-role set;
   *  Per role clears the role-scoped sets (leaving any both-role values). */
  const removeAttribute = (): void => {
    if (!editable || !onChange) return;
    // In focused mode, only clear the overlay's own kind(s) — never a neighbour
    // kind sharing this count. The active role rail is cleared (both vs per-role).
    const inScope = (a: Attribute) => onlyKinds == null || onlyKinds.includes(a.kind);
    const inActiveRail = (a: Attribute) => (rolesMode === "both" ? a.role == null : a.role != null);
    onChange(live.filter((a) => !(inScope(a) && inActiveRail(a))));
  };

  /** One registry kind → a labelled fieldset of value chips (+ free-text add),
   *  scoped to a role (null = both). Selected pills fill studio-blue (1.12). */
  const renderKind = (kind: RegistryKind, scope: RoleScope) => {
    const suggestions = kind.values ?? [];
    // Selected values not in the suggestion list (e.g. a free-text footwork) still
    // render as chips so a custom value is visible + clearable. Read-only shows
    // any-role values; editable scopes to the current rail.
    const matchScope = (a: Attribute) =>
      a.kind === kind.kind && (!editable || (a.role ?? null) === scope);
    const customSelected = live
      .filter(matchScope)
      .map((a) => normalizeValue(kind.kind, String(a.value)))
      .filter((v) => !suggestions.includes(v));
    const lookupScope: RoleScope | "any" = editable ? scope : "any";

    return (
      // A <fieldset> is implicitly role="group", named by its <legend> — so
      // both `getByRole("heading")` (the <h3>) and `getByRole("group", { name })`
      // resolve per kind (US-029).
      <fieldset
        key={`${kind.kind}-${scope ?? "both"}`}
        className="flex flex-wrap items-center gap-1"
      >
        <legend className="mb-1 flex w-full items-center gap-1">
          <h3 className="text-2xs font-bold text-ink-faint">{kind.label}</h3>
          {/* Per-kind info affordance → the plain-language reference (frame 1.13). */}
          <IconButton label={t.aboutKind(kind.label)} onClick={() => setInfoKind(kind)}>
            <InfoIcon size={14} />
          </IconButton>
        </legend>

        {[...suggestions, ...customSelected].map((v) => {
          const on = selected(kind.kind, v, lookupScope);
          if (!editable) {
            // Read-only: show only the selected values, as static chips (full label).
            return on ? (
              <Chip key={v} tone="neutral" asStatic>
                {labelValue(kind.kind, v)}
              </Chip>
            ) : null;
          }
          // Selected value pills fill studio-blue (frame 1.12); unselected outline.
          // The chip reads as the FULL label ("Heel-Toe", not "HT"); the tight code
          // is the reading overview's job (abbrevValue).
          return (
            <Chip
              key={v}
              tone="direction"
              selected={on}
              onClick={() => toggle(kind.kind, kind.cardinality, v, scope)}
            >
              {labelValue(kind.kind, v)}
            </Chip>
          );
        })}

        {editable && (kind.freeTextInput ?? kind.freeText) && (
          <FreeTextAdd
            label={kind.label}
            onAdd={(v) => toggle(kind.kind, kind.cardinality, v, scope)}
          />
        )}

        {/* Inline explanation: tapping a value selects it AND reveals its one-line
            definition (registry valueDefs), so "what does HT mean?" is answered in
            place — the per-kind ⓘ overlay still lists every value's prose. */}
        <SelectedDefs
          values={[...suggestions, ...customSelected].filter((v) =>
            selected(kind.kind, v, lookupScope),
          )}
          valueDefs={kind.valueDefs}
        />
      </fieldset>
    );
  };

  // Progressive disclosure (design parity): the step IDENTITY — direction
  // (headline) + footwork — leads; the technique kinds (rise/position/sway/turn/
  // body actions + custom) sit behind a "More attributes" toggle so the common
  // case is one focused choice, not a wall of every kind at once.
  const allKinds = kindsFor(useLocalizedRegistry(), dance, customKinds);
  // Focused (single-attribute overlay): only this column's kind(s), all shown flat
  // with no disclosure. Full editor: the step identity leads, technique behind a
  // "More attributes" toggle.
  const kinds = focused ? allKinds.filter((k) => onlyKinds.includes(k.kind)) : allKinds;
  const IDENTITY = new Set(["direction", "footwork"]);
  const primary = focused ? kinds : kinds.filter((k) => IDENTITY.has(k.kind));
  const secondary = focused ? [] : kinds.filter((k) => !IDENTITY.has(k.kind));

  /** The kind sections for a role scope, with the technique disclosure. */
  const renderSections = (scope: RoleScope) => (
    <>
      {primary.map((k) => renderKind(k, scope))}
      {secondary.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showMore}
            onClick={() => setShowMore((v) => !v)}
          >
            {showMore ? t.fewerAttributes : t.moreAttributes}
          </Button>
          {showMore && secondary.map((k) => renderKind(k, scope))}
        </div>
      )}
    </>
  );

  return (
    <section className="flex flex-col gap-3" aria-label={t.attributesForCount(count)}>
      {/* ROLES toggle (frame 1.12) — Same for both vs Per role. Editor-only. */}
      {editable && (
        <div className="flex items-center gap-2">
          <span className="text-2xs font-bold uppercase tracking-wider text-ink-muted">
            {t.rolesLegend}
          </span>
          <SegmentedToggle<RolesMode>
            ariaLabel={t.rolesLegend}
            value={rolesMode}
            onChange={setRolesMode}
            options={[
              { value: "both", label: t.rolesSameForBoth },
              { value: "perRole", label: t.rolesPerRole },
            ]}
          />
        </div>
      )}

      {!editable || rolesMode === "both" ? (
        renderSections(null)
      ) : (
        <>
          <RoleRail side="leader">{renderSections("leader")}</RoleRail>
          <RoleRail side="follower">{renderSections("follower")}</RoleRail>
        </>
      )}

      {/* Per-attribute actions (frame 1.12): Remove clears this attribute; Save
          confirms + closes (edits already auto-saved via onChange). */}
      <div className="flex items-center gap-2">
        {editable && (
          <button
            type="button"
            onClick={() => {
              removeAttribute();
              onDone?.();
            }}
            className="rounded-md border px-3 py-2 text-xs font-bold"
            style={{ color: "var(--bf-danger)", borderColor: "var(--bf-danger)" }}
          >
            {focused ? t.remove : t.removeAttribute}
          </button>
        )}
        {onDone && (
          <Button variant="primary" size="sm" onClick={onDone}>
            {t.save}
          </Button>
        )}
      </div>

      {/* The plain-language reference for one kind (frame 1.13), reachable from
          every kind's info affordance. Registry-derived; works for custom kinds. */}
      {infoKind && (
        <AttributeInfoSheet
          open
          kind={infoKind}
          usageCount={usageFor(infoKind.kind)}
          scopeLabel={scopeLabel}
          onClose={() => setInfoKind(null)}
        />
      )}
    </section>
  );
}

/** A per-role rail (frame 1.12): a labelled group with a colored left rail —
 *  studio-blue for the leader, red for the follower — so the two sides read
 *  apart without relying on color alone (the heading carries the role word). */
function RoleRail({ side, children }: { side: "leader" | "follower"; children: ReactNode }) {
  const color = side === "leader" ? "var(--bf-kind-direction)" : "var(--bf-danger)";
  const label = side === "leader" ? "Leader" : "Follower";
  return (
    <fieldset
      className="flex flex-col gap-3 border-l-[3px] pl-3"
      style={{ borderColor: color }}
      aria-label={label}
    >
      <legend className="text-2xs font-bold uppercase tracking-wider" style={{ color }}>
        {label}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * The one-line definition(s) of the currently-selected value(s) for a kind, shown
 * under its chips. `valueDefs` is the registry's per-value glossary; values with no
 * definition (custom kinds) render nothing. Full width so it wraps below the chips.
 */
function SelectedDefs({
  values,
  valueDefs,
}: {
  values: string[];
  valueDefs?: Record<string, string>;
}) {
  const defs = values.map((v) => valueDefs?.[v]).filter((d): d is string => Boolean(d));
  if (defs.length === 0) return null;
  return (
    <p className="w-full text-2xs text-ink-muted">
      {defs.map((d) => (
        <span key={d} className="block">
          {d}
        </span>
      ))}
    </p>
  );
}

/**
 * A tiny inline form to enter a CUSTOM value for a free-text kind (step, §3/#83):
 * the registry values are suggestions, this adds anything else (e.g. a named
 * action). Submitting a non-empty value calls `onAdd` and clears the input.
 */
function FreeTextAdd({ label, onAdd }: { label: string; onAdd: (value: string) => void }) {
  const t = useMessages(attributesMessages);
  const [text, setText] = useState("");
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText("");
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <Input
        label={t.customValueLabel(label)}
        hideLabel
        placeholder={t.customValuePlaceholder(label)}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" variant="secondary" size="sm" disabled={!text.trim()}>
        {t.add}
      </Button>
    </form>
  );
}
