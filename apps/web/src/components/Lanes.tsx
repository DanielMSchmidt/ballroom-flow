// US-044 — Lanes: one attribute kind across all counts of a figure.
//
// Lays out a single attribute kind as an editable grid — complementary to
// FigureTimeline (which shows all kinds for one count at a time). Editing
// emits the figure's FULL next attribute set via onChange, identical in
// contract to FigureTimeline, so a lane edit and a timeline edit are
// indistinguishable downstream.
//
// Honors the same per-device role-view toggle as FigureTimeline (US-030,
// PLAN §1.5, principle #25): the view is local UI state, not a stored
// User.defaultRole. New values added through the inline picker inherit
// the current view.
//
// Controlled: `attributes` is the figure's full attribute set; every edit
// emits the next full set via `onChange`.
//
// biome-ignore-all lint/a11y/useSemanticElements: ARIA grid widget needs
// explicit role="grid" / role="gridcell" — the native <table>/<td> mapping
// is NOT recognized as gridcell by the test renderer's aria-query version.
// biome-ignore-all lint/a11y/useFocusableInteractive: gridcell keyboard
// navigation is handled by the contained <button> (tab→button; arrows between
// cells is a grid-level responsibility not yet implemented for this MVP lane).

import {
  ATTRIBUTE_REGISTRY,
  type Attribute,
  type DanceId,
  mergeRegistry,
  normalizeValue,
  type RegistryKind,
} from "@ballroom/domain";
import { useMemo, useState } from "react";
import { ATTRIBUTE_KINDS, type AttributeKind, Button, Chip, cx } from "../ui";
import type { MembershipRole } from "./Assemble";
import { filterByRoleView } from "./role-view";

type RoleView = "leader" | "follower";

/** The other side of a leader/follower toggle. */
const flipped = (v: RoleView): RoleView => (v === "leader" ? "follower" : "leader");

/** Capitalize a role for display ("leader" → "Leader"). */
const roleLabel = (v: RoleView): string => v.charAt(0).toUpperCase() + v.slice(1);

/** Tint a value chip by its attribute kind when that kind has a token color. */
const chipTone = (kind: string): AttributeKind | "neutral" =>
  (ATTRIBUTE_KINDS as readonly string[]).includes(kind) ? (kind as AttributeKind) : "neutral";

/** A displayable label for an attribute value (string, or a joined set). */
const displayValue = (value: unknown): string =>
  Array.isArray(value) ? value.map(String).join(", ") : String(value);

export interface LanesProps {
  /** The attribute kind to lay out across all counts (e.g. "sway", "turn"). */
  kind: string;
  /** Membership role — only an editor can place/edit attributes. */
  role: MembershipRole;
  /** The dance, accepted for prop-interface parity with FigureTimeline. */
  dance?: DanceId;
  /** How many whole counts to lay out (default one 8-count phrase). */
  counts?: number;
  /** The figure's current full attribute set (controlled). */
  attributes?: Attribute[];
  /** The viewed role lens (US-030); new values inherit it. */
  initialView?: "leader" | "follower";
  /** User-defined kinds to merge into the attribute registry (US-043). */
  customKinds?: RegistryKind[];
  /** Emits the figure's next full attribute set after an edit. */
  onChange?: (next: Attribute[]) => void;
}

export function Lanes({
  kind,
  role,
  counts = 8,
  attributes,
  initialView,
  customKinds = [],
  onChange,
}: LanesProps) {
  // FULLY CONTROLLED: attributes derive directly from the prop — no internal
  // copy. Only transient UI state (which count's picker is open, role view)
  // lives in the component.
  const attrs = attributes ?? [];
  const [openCount, setOpenCount] = useState<number | null>(null);
  // The role lens is local UI state (US-030, principle #25).
  const [view, setView] = useState<RoleView>(initialView ?? "leader");

  // Resolve the kind descriptor from the merged registry (custom kinds first).
  const kindDescriptor = useMemo(() => {
    const reg = mergeRegistry(ATTRIBUTE_REGISTRY, customKinds);
    return reg[kind] ?? null;
  }, [kind, customKinds]);

  // Build a per-count map scoped to this kind (ignore other kinds).
  const byCount = useMemo(() => {
    const map = new Map<number, Attribute[]>();
    for (const a of attrs) {
      if (a.deletedAt != null) continue;
      if (a.kind !== kind) continue;
      const list = map.get(a.count) ?? [];
      list.push(a);
      map.set(a.count, list);
    }
    return map;
  }, [attrs, kind]);

  const cells = Array.from({ length: counts }, (_, i) => i + 1);
  const editable = role === "editor";

  /** Emit the full attribute set with this count's kind values replaced. */
  const onCountKindChange = (count: number, next: Attribute[]): void => {
    // Keep all attributes that are NOT (this kind on this count), plus any
    // soft-deleted ones (tombstones must be preserved — never hard-remove).
    const others = attrs.filter(
      (a) => !(a.kind === kind && a.count === count) || a.deletedAt != null,
    );
    onChange?.([...others, ...next]);
  };

  /** Toggle one value for a count+kind cell, honoring cardinality, and emit. */
  const toggle = (count: number, raw: string): void => {
    if (!editable || !onChange || !kindDescriptor) return;
    const v = normalizeValue(kind, raw);
    const live = byCount.get(count) ?? [];
    const isOn = live.some((a) => normalizeValue(kind, String(a.value)) === v);
    let next: Attribute[];
    if (isOn) {
      // Re-tap clears this value (US-028 AC-2 shape).
      next = live.filter((a) => normalizeValue(kind, String(a.value)) !== v);
    } else if (kindDescriptor.cardinality === "single") {
      // Single: replace any existing value of this kind at this count.
      next = [{ id: `${kind}-${count}-${v}`, kind, count, value: v, role: view, deletedAt: null }];
    } else {
      // Multi: add to the set.
      next = [
        ...live,
        { id: `${kind}-${count}-${v}`, kind, count, value: v, role: view, deletedAt: null },
      ];
    }
    onCountKindChange(count, next);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Role lens: per-device view toggle, never a stored role (principle #25).
          Label matches FigureTimeline exactly so the UX is consistent (#8). */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-secondary">
          Viewing: <span className="font-medium text-ink">{roleLabel(view)}</span>
        </span>
        <Button variant="secondary" size="sm" onClick={() => setView(flipped(view))}>
          Flip role to {flipped(view)}
        </Button>
      </div>

      {/* Explicit role="grid" is required: aria-query in the test renderer does
          NOT map <table role="grid"> children to gridcell implicitly. */}
      <div role="grid" aria-label={`${kindDescriptor?.label ?? kind} lane`} className="flex gap-1">
        {cells.map((count) => {
          const onCount = byCount.get(count) ?? [];
          // Visible chips: this count's kind attrs filtered by role view.
          const visible = filterByRoleView(onCount, view);
          const isOpen = openCount === count;

          return (
            /* tabIndex={-1} makes the cell programmatically focusable (arrow-key
               navigation pattern for grids); the button handles Tab focus. */
            <div key={count} role="gridcell" tabIndex={-1} className="flex flex-col gap-1 p-1">
              {/* Count tap target — opens/closes the inline value picker. */}
              <button
                type="button"
                aria-label={`count ${count}`}
                aria-expanded={isOpen}
                onClick={() => setOpenCount(isOpen ? null : count)}
                className={cx(
                  "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border",
                  isOpen ? "border-accent" : "border-line",
                )}
              >
                {count}
              </button>

              {/* Always-visible chips: this count's kind values (role-filtered).
                  Hidden when filterByRoleView omits them (e.g. follower chip in
                  leader view). */}
              {visible.length > 0 && (
                <ul className="flex flex-col items-center gap-0.5 pt-1">
                  {visible.map((a) => (
                    <li key={a.id}>
                      <Chip asStatic tone={chipTone(kind)}>
                        {displayValue(a.value)}
                      </Chip>
                    </li>
                  ))}
                </ul>
              )}

              {/* Inline value picker when this cell is open. */}
              {isOpen && kindDescriptor && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {(kindDescriptor.values ?? []).map((v) => {
                    const nv = normalizeValue(kind, v);
                    const live = byCount.get(count) ?? [];
                    const isSelected = live.some(
                      (a) => normalizeValue(kind, String(a.value)) === nv,
                    );
                    if (!editable) {
                      // Commenter/viewer: show only selected values, read-only.
                      return isSelected ? (
                        <Chip key={v} tone={chipTone(kind)} asStatic>
                          {v}
                        </Chip>
                      ) : null;
                    }
                    return (
                      <Chip
                        key={v}
                        tone={chipTone(kind)}
                        selected={isSelected}
                        onClick={() => toggle(count, v)}
                      >
                        {v}
                      </Chip>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
