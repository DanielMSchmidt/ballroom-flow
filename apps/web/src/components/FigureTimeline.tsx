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

import {
  type Attribute,
  barsForFigure,
  countLabel,
  DANCES,
  type DanceId,
  type RegistryKind,
} from "@ballroom/domain";
import { useMemo, useState } from "react";
import { Button, Card, Chip, CountLabel, cx } from "../ui";
import type { MembershipRole } from "./Assemble";
import { AttributeEditor } from "./AttributeEditor";
import {
  chipTone,
  displayValue,
  filterByRoleView,
  flipped,
  type RoleView,
  roleLabel,
} from "./role-view";

export interface FigureTimelineProps {
  /** Membership role — only an editor can place/edit attributes. */
  role: MembershipRole;
  /** The dance, to scope the attribute registry (US-029). */
  dance?: DanceId;
  /** The figure's current attributes (controlled-with-fallback). */
  attributes?: Attribute[];
  /** Override the whole-count count. When omitted, the count is dance-aware:
   *  one phrase from the dance (Waltz 6 / others 8), extended to cover any
   *  attribute placed in a later phrase. */
  counts?: number;
  /** The viewed role lens (US-030); new values inherit it. */
  initialView?: "leader" | "follower";
  /** User-defined kinds to merge into the attribute registry (US-043). */
  customKinds?: RegistryKind[];
  /** Emits the figure's next full attribute set after an edit. */
  onChange?: (next: Attribute[]) => void;
  /** Whether the figure is the user's own ("owned") or a non-owned global/shared
   *  figure ("global") — editing a "global" figure copies it to a variant (US-035). */
  figureScope?: "owned" | "global";
  /** Explicit "Fork into variant" action (US-036). */
  onForkIntoVariant?: () => void;
  /** The base figure's display name, for the "Variant of …" lineage badge. */
  baseName?: string;
}

export function FigureTimeline({
  role,
  dance,
  attributes,
  counts,
  initialView,
  customKinds = [],
  onChange,
  figureScope,
  onForkIntoVariant,
  baseName,
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
  const [copied, setCopied] = useState(false);
  const [forked, setForked] = useState(false);
  const isGlobal = figureScope === "global";

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

  // Dance-aware beat ruler (2026-06-28 parity): instead of a flat 8-count strip,
  // lay out the dance's phrase (Waltz = a 6-beat phrase of two 3-beat bars; 4/4
  // dances = 8), extended to cover any attribute placed in a later phrase. An
  // explicit `counts` prop still wins (e.g. a fixed read-only render).
  const meta = dance ? DANCES[dance] : undefined;
  const beatsPerBar = meta?.beatsPerBar ?? 4;
  const phraseBeats = meta?.phraseBeats ?? 8;
  const { bars } = useMemo(() => {
    const liveCounts = attrs.filter((a) => a.deletedAt == null).map((a) => a.count);
    const maxWhole = liveCounts.reduce((m, c) => Math.max(m, Math.ceil(c)), 0);
    const phrases = dance ? barsForFigure(liveCounts, dance) : 1;
    const total = counts ?? Math.max(phraseBeats * phrases, maxWhole, beatsPerBar);
    const list = Array.from({ length: total }, (_, i) => i + 1);
    const grouped: number[][] = [];
    for (let i = 0; i < list.length; i += beatsPerBar) grouped.push(list.slice(i, i + beatsPerBar));
    return { bars: grouped };
  }, [attrs, counts, dance, phraseBeats, beatsPerBar]);

  /** Replace this count's attributes within the figure's full set + emit. */
  const onCountChange = (count: number, next: Attribute[]): void => {
    const others = attrs.filter((a) => a.count !== count || a.deletedAt != null);
    if (isGlobal && !copied) setCopied(true);
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

      {isGlobal && (
        <div className="flex flex-col gap-1">
          {(copied || forked) && (
            <p role="status" className="text-2xs text-accent">
              {forked ? `Variant of ${baseName ?? "the base figure"}` : "Copied as your variant"}
            </p>
          )}
          {role === "editor" && !forked && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setForked(true);
                onForkIntoVariant?.();
              }}
            >
              Fork into variant
            </Button>
          )}
        </div>
      )}

      {/* Dance-aware beat ruler: beats grouped into bars (Waltz → bars of 3). */}
      <ol className="flex flex-wrap items-start gap-3" aria-label="Count timeline">
        {bars.map((bar, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: bars are a stable positional grid
          <li key={`bar-${i}`}>
            <ol
              aria-label={`bar ${i + 1}`}
              className="flex gap-1 rounded-lg bg-surface-sunken/40 p-1"
            >
              {bar.map((count) => {
                const onCount = byCount.get(count) ?? [];
                const visible = filterByRoleView(onCount, view);
                const has = onCount.length > 0;
                // The step's direction is its headline (the rest are slots below).
                const direction = visible.find((a) => a.kind === "direction");
                const slots = visible.filter((a) => a.kind !== "direction");
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
                    {direction && (
                      <span data-testid={`step-headline-${count}`}>
                        <Chip asStatic tone="direction">
                          {displayValue(direction.value)}
                        </Chip>
                      </span>
                    )}
                    {slots.length > 0 && (
                      <ul
                        className="flex flex-col items-center gap-0.5"
                        aria-label={`count ${count} attributes`}
                      >
                        {slots.map((a) => (
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
          </li>
        ))}
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
