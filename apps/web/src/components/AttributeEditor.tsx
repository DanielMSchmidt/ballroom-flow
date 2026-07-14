// US-028 / US-029 / WEP-0005 — the attribute editor for ONE count on a figure
// timeline.
//
// Registry-driven (US-003): the sections + value options render from the merged
// ATTRIBUTE_REGISTRY — attribute kinds are DATA, not code. Single-cardinality
// kinds (rise/position) keep one value; multi kinds (bodyActions) hold a set.
// Re-tapping a selected value CLEARS it (US-028 AC-2). Editing is editor-only
// (AC-4): a commenter/viewer sees the values as static chips with no toggle.
// Dance scoping (Tango hides rise) is US-029; honored here via appliesToDances
// so it's correct from the start.
//
// The ROLE lens is the WRITE SCOPE (WEP-0005) — there is no per-attribute roles
// control. Under "both", one edit notates both dancers: the leader's value
// verbatim plus the follower's DERIVED per the kind's `bothWrite` registry
// entry (direction/sway mirror, footwork stays the leader's, everything else
// collapses to one shared role:null attribute). Under a single role, every
// write/removal first SPLITS a shared value (the other role keeps what it saw)
// and then touches only its own side — a value placed for the leader can never
// leak into the follower's chart. The Both scope only edits derivation-
// consistent state; the timeline locks diverged cells before they get here.
//
// Controlled: `value` is this count's current attributes; every edit emits the
// next attribute set via `onChange`. The screen wires `onChange` to the store's
// setAttribute mutation; component tests pass it directly.
import {
  type Attribute,
  bothWriteTargets,
  type DanceId,
  isBothConsistent,
  mergeRegistry,
  normalizeValue,
  type RegistryKind,
  type StandardRegistry,
  splitSharedForRole,
} from "@weavesteps/domain";
import { type FormEvent, useState } from "react";
import { useLocalizedRegistry, useMessages } from "../i18n";
import { attributesMessages } from "../i18n/messages/attributes";
import { Button, Chip, IconButton, InfoIcon, Input } from "../ui";
import type { MembershipRole } from "./Assemble";
import { AttributeInfoSheet } from "./AttributeInfoSheet";
import { labelValue } from "./attribute-display";
import type { EditRoleView } from "./role-view";

export interface AttributeEditorProps {
  /** The float count these attributes sit on. */
  count: number;
  /** Membership role — only an editor can toggle values (AC-4). */
  role: MembershipRole;
  /** The dance, to scope the registry (e.g. Tango omits rise — US-029). */
  dance?: DanceId;
  /** The role lens = the WRITE SCOPE (WEP-0005). Defaults to "both". */
  view?: EditRoleView;
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

/** A this-count attribute literal with the editor's deterministic id. */
function makeAttr(
  kind: string,
  count: number,
  value: unknown,
  role: "leader" | "follower" | null,
): Attribute {
  return {
    id: `${kind}-${count}-${String(value)}-${role ?? "both"}`,
    kind,
    count,
    value,
    role,
    deletedAt: null,
  };
}

export function AttributeEditor({
  count,
  role,
  dance,
  view = "both",
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
  // What the active lens SEES (and edits): shared values plus its own role's.
  // Under "both" that is the leader projection — the verbatim side of a Both
  // write (the follower's is derived from it).
  const lensRole = view === "both" ? "leader" : view;
  const visible = (a: Attribute): boolean => a.role == null || a.role === lensRole;
  // "Used in N steps": distinct counts that carry a (live) value of this kind,
  // across the whole figure when provided (else just this count's value).
  const usageFor = (k: string): number => {
    const source = figureAttributes ?? value;
    return new Set(source.filter((a) => a.deletedAt == null && a.kind === k).map((a) => a.count))
      .size;
  };
  /** Whether a (kind, value) is selected under the active lens. */
  const selected = (kind: string, v: string): boolean =>
    live.some((a) => a.kind === kind && visible(a) && normalizeValue(kind, String(a.value)) === v);

  /** Toggle one value of a kind under the lens scope, honoring cardinality. */
  const toggle = (kind: RegistryKind, raw: string): void => {
    if (!editable || !onChange) return;
    const v = normalizeValue(kind.kind, raw);
    const isOn = selected(kind.kind, v);
    const ofKind = (a: Attribute) => a.kind === kind.kind;

    if (view === "both") {
      // Guard: Both only edits derivation-consistent state (the timeline locks
      // diverged cells, but the full per-count editor can still reach one).
      if (!isBothConsistent(kind, live)) return;
      if (kind.cardinality === "multi") {
        // Multi kinds are copy kinds: Both toggles the SHARED set (role=null),
        // dropping any presence-only (value: null) attr the pick supersedes.
        const rest = live.filter((a) => !(ofKind(a) && (a.value == null || isOn)));
        const next = isOn
          ? live.filter((a) => !(ofKind(a) && normalizeValue(kind.kind, String(a.value)) === v))
          : [...rest, makeAttr(kind.kind, count, v, null)];
        onChange(next);
        return;
      }
      // Single: a Both write replaces the whole slot (every role — it is either
      // shared or Both's own consistent pair). Re-tap clears the slot.
      const others = live.filter((a) => !ofKind(a));
      if (isOn) {
        onChange(others);
        return;
      }
      const targets = bothWriteTargets(kind, v);
      const written =
        "shared" in targets
          ? [makeAttr(kind.kind, count, targets.shared, null)]
          : [
              makeAttr(kind.kind, count, targets.leader, "leader"),
              ...(targets.follower !== undefined
                ? [makeAttr(kind.kind, count, targets.follower, "follower")]
                : []),
            ];
      onChange([...others, ...written]);
      return;
    }

    // Single-role scope: split any shared value of this kind first (the other
    // role keeps what it saw), then edit only this role's side.
    const base = splitSharedForRole(live, kind.kind, count, view);
    const inMySlot = (a: Attribute) => ofKind(a) && a.role === view;
    let next: Attribute[];
    if (isOn) {
      // Re-tap clears this value (US-028 AC-2) — from this role only.
      next = base.filter((a) => !(inMySlot(a) && normalizeValue(kind.kind, String(a.value)) === v));
    } else if (kind.cardinality === "single") {
      next = [...base.filter((a) => !inMySlot(a)), makeAttr(kind.kind, count, v, view)];
    } else {
      // Multi: add to this role's set — dropping any presence-only (value: null)
      // attr in the slot, which the picked value supersedes (Builder v3 ②).
      next = [
        ...base.filter((a) => !(inMySlot(a) && a.value == null)),
        makeAttr(kind.kind, count, v, view),
      ];
    }
    onChange(next);
  };

  /** Clear this count's values for the lens scope — the red "remove attribute"
   *  action (frame 1.12). Both clears the whole (consistent) slot; a single
   *  role splits shared values first and clears only its own side. */
  const removeAttribute = (): void => {
    if (!editable || !onChange) return;
    // In focused mode, only clear the overlay's own kind(s) — never a neighbour
    // kind sharing this count.
    const inScope = (a: Attribute) => onlyKinds == null || onlyKinds.includes(a.kind);
    if (view === "both") {
      onChange(live.filter((a) => !inScope(a)));
      return;
    }
    let next = live;
    for (const k of new Set(live.filter(inScope).map((a) => a.kind))) {
      next = splitSharedForRole(next, k, count, view);
    }
    onChange(next.filter((a) => !(inScope(a) && a.role === view)));
  };

  /** One registry kind → a labelled fieldset of value chips (+ free-text add).
   *  Selected pills fill studio-blue (1.12). */
  const renderKind = (kind: RegistryKind) => {
    const suggestions = kind.values ?? [];
    // Selected values not in the suggestion list (e.g. a free-text footwork)
    // still render as chips so a custom value is visible + clearable. Both the
    // read-only and editable renders scope to the active lens (WEP-0005 — no
    // cross-role leak).
    const customSelected = live
      .filter((a) => a.kind === kind.kind && visible(a))
      .map((a) => normalizeValue(kind.kind, String(a.value)))
      .filter((v) => !suggestions.includes(v));

    return (
      // A <fieldset> is implicitly role="group", named by its <legend> — so
      // both `getByRole("heading")` (the <h3>) and `getByRole("group", { name })`
      // resolve per kind (US-029).
      <fieldset key={kind.kind} className="flex flex-wrap items-center gap-1">
        <legend className="mb-1 flex w-full items-center gap-1">
          <h3 className="text-2xs font-bold text-ink-faint">{kind.label}</h3>
          {/* Per-kind info affordance → the plain-language reference (frame 1.13). */}
          <IconButton label={t.aboutKind(kind.label)} onClick={() => setInfoKind(kind)}>
            <InfoIcon size={14} />
          </IconButton>
        </legend>

        {[...suggestions, ...customSelected].map((v) => {
          const on = selected(kind.kind, v);
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
            <Chip key={v} tone="direction" selected={on} onClick={() => toggle(kind, v)}>
              {labelValue(kind.kind, v)}
            </Chip>
          );
        })}

        {editable && (kind.freeTextInput ?? kind.freeText) && (
          <FreeTextAdd label={kind.label} onAdd={(v) => toggle(kind, v)} />
        )}

        {/* Inline explanation: tapping a value selects it AND reveals its one-line
            definition (registry valueDefs), so "what does HT mean?" is answered in
            place — the per-kind ⓘ overlay still lists every value's prose. */}
        <SelectedDefs
          values={[...suggestions, ...customSelected].filter((v) => selected(kind.kind, v))}
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

  // The scope banner (WEP-0005, design Builder v3): states which side(s) this
  // edit writes — the lens replaces the old per-attribute ROLES toggle.
  const scopeBanner =
    view === "both"
      ? { title: t.writingForBoth, note: t.writingForBothNote, follower: false }
      : view === "leader"
        ? { title: t.writingForLeader, note: t.writingForLeaderNote, follower: false }
        : { title: t.writingForFollower, note: t.writingForFollowerNote, follower: true };

  return (
    <section className="flex flex-col gap-3" aria-label={t.attributesForCount(count)}>
      {editable && (
        <p
          className="flex flex-wrap items-center gap-2 rounded-md border-[1.5px] px-3 py-2"
          style={{
            borderColor: scopeBanner.follower ? "var(--bf-danger)" : "var(--bf-border-strong)",
          }}
        >
          <span
            className="text-2xs font-bold uppercase tracking-wider"
            style={{
              color: scopeBanner.follower ? "var(--bf-danger)" : "var(--bf-kind-direction)",
            }}
          >
            {scopeBanner.title}
          </span>
          <span className="text-2xs text-ink-muted">{scopeBanner.note}</span>
        </p>
      )}

      {primary.map((k) => renderKind(k))}
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
          {showMore && secondary.map((k) => renderKind(k))}
        </div>
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
            {t.done}
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
