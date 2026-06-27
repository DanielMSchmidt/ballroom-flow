// US-028 / US-030 — the figure timeline (the hero flow). PLAN §4.4/§4.5, §1.5.
//
// A row of count cells (conventional labels via countLabel/US-004). Tapping a
// count opens the AttributeEditor for it; choosing a value adds/edits/removes an
// attribute on that count (registry-driven, US-003). Editing is editor-only.
//
// Role is a VIEW, not an identity (US-030, PLAN §1.5, principle #25): a dedicated
// leader/follower toggle flips the lens as a per-device preference — there is NO
// stored User.defaultRole, it's local UI state. Each count shows the attribute
// values visible in the current lens: role=null ("both") values ALWAYS show
// (AC-2); role-specific values show ONLY for the selected role (AC-3). New
// values added through the editor inherit the lens.
//
// Controlled-with-fallback: seeds from the `attributes` prop and emits every
// edit via `onChange` (the screen wires it to the store's setAttribute mutation;
// tests pass it directly or omit it).

import { type Attribute, countLabel, type DanceId, type RegistryKind } from "@ballroom/domain";
import { useMemo, useState } from "react";
import { ATTRIBUTE_KINDS, type AttributeKind, Button, Card, Chip, CountLabel, cx } from "../ui";
import type { MembershipRole } from "./Assemble";
import { AttributeEditor } from "./AttributeEditor";
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

export interface FigureTimelineProps {
  /** Membership role — only an editor can place/edit attributes. */
  role: MembershipRole;
  /** The dance, to scope the attribute registry (US-029). */
  dance?: DanceId;
  /** The figure's current attributes (controlled-with-fallback). */
  attributes?: Attribute[];
  /** How many whole counts to lay out (default one 8-count phrase). */
  counts?: number;
  /** The viewed role lens (US-030); new values inherit it. */
  initialView?: "leader" | "follower";
  /** User-defined kinds to merge into the attribute registry (US-043). */
  customKinds?: RegistryKind[];
  /** Emits the figure's next full attribute set after an edit. */
  onChange?: (next: Attribute[]) => void;
}

export function FigureTimeline({
  role,
  dance,
  attributes,
  counts = 8,
  initialView,
  customKinds = [],
  onChange,
}: FigureTimelineProps) {
  // FULLY CONTROLLED (#151): the rendered attributes derive directly from the
  // `attributes` prop (the store snapshot) — NO internal copy. A collaborator's
  // synced edit flows in via the prop and re-renders; local edits go out via
  // `onChange` and come back as the next prop. Only transient UI state (which
  // count's editor is open) lives in the component.
  const attrs = attributes ?? [];
  const [openCount, setOpenCount] = useState<number | null>(null);
  // The role lens is local UI state (US-030): a per-device view toggle, NOT a
  // stored user role (principle #25). New editor values inherit it.
  const [view, setView] = useState<RoleView>(initialView ?? "leader");

  const byCount = useMemo(() => {
    const map = new Map<number, Attribute[]>();
    for (const a of attrs) {
      if (a.deletedAt != null) continue;
      const list = map.get(a.count) ?? [];
      list.push(a);
      map.set(a.count, list);
    }
    return map;
  }, [attrs]);

  const cells = Array.from({ length: counts }, (_, i) => i + 1);

  /** Replace this count's attributes within the figure's full set + emit. */
  const onCountChange = (count: number, next: Attribute[]): void => {
    const others = attrs.filter((a) => a.count !== count || a.deletedAt != null);
    onChange?.([...others, ...next]);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* The role lens: a per-device view toggle, never a stored role (#25). The
          label names the current view AND the action, so it's clear to AT (#8). */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-secondary">
          Viewing: <span className="font-medium text-ink">{roleLabel(view)}</span>
        </span>
        <Button variant="secondary" size="sm" onClick={() => setView(flipped(view))}>
          Flip role to {flipped(view)}
        </Button>
      </div>

      <ol className="flex flex-wrap gap-1" aria-label="Count timeline">
        {cells.map((count) => {
          const onCount = byCount.get(count) ?? [];
          const visible = filterByRoleView(onCount, view);
          const has = onCount.length > 0;
          return (
            <li key={count} className="flex min-w-[44px] flex-col items-center gap-1">
              <button
                type="button"
                aria-label={`count ${count}`}
                aria-expanded={openCount === count}
                onClick={() => setOpenCount(openCount === count ? null : count)}
                className={cx(
                  "relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border",
                  openCount === count ? "border-accent" : "border-line",
                )}
              >
                <CountLabel value={countLabel(count)} />
                {has && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent"
                  />
                )}
              </button>
              {visible.length > 0 && (
                <ul
                  className="flex flex-col items-center gap-0.5"
                  aria-label={`count ${count} attributes`}
                >
                  {visible.map((a) => (
                    <li key={a.id}>
                      <Chip asStatic tone={chipTone(a.kind)}>
                        {displayValue(a.value)}
                      </Chip>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {openCount !== null && (
        <Card>
          <AttributeEditor
            count={openCount}
            role={role}
            dance={dance}
            view={view}
            customKinds={customKinds}
            value={byCount.get(openCount) ?? []}
            onChange={(next) => onCountChange(openCount, next)}
          />
        </Card>
      )}
    </div>
  );
}
