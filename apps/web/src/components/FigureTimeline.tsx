// US-028 / US-030 — the figure timeline (the hero flow). PLAN §4.4/§4.5, §1.5.
// 2026-06-28 parity: rebuilt to the docs/design/ballroom-flow.pen "FigureEditor"
// frame — a dance-aware BAR / BEAT layout of step cards rather than a flat strip.
//
// Each whole beat is a lane: a beat-tick on the left, then the step card(s) that
// start in that beat. A step card shows its headline ("RF forward" — foot is not
// stored; steps alternate feet, see vocabulary.ts), a duration pill that can be
// dragged / arrowed to resize the step (snapped to the grid), and a lane of the
// step's attribute chips with ghost "+ kind" add-chips for what's still empty.
// Tapping a card/chip opens the per-count AttributeEditor (registry-driven,
// US-003); editing is editor-only.
//
// Role is a VIEW, not an identity (US-030, principle #25): a per-device lens
// toggle, never a stored role. role=null ("both") values always show; role
// values show only for the selected lens; new values inherit the lens.
//
// Fully controlled (#151): the rendered attributes derive from the `attributes`
// prop; edits go out via `onChange` and return as the next prop. Only transient
// UI (open count, lens, snap grid) is local state.

import {
  ATTRIBUTE_REGISTRY,
  type Attribute,
  barsForFigure,
  countLabel,
  DANCES,
  type DanceId,
  mergeRegistry,
  type RegistryKind,
} from "@ballroom/domain";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useState,
} from "react";
import { Button, Card, cx, kindVar, PlusIcon } from "../ui";
import type { AttributeKind } from "../ui/tokens";
import type { MembershipRole } from "./Assemble";
import { AttributeEditor } from "./AttributeEditor";
import { shortKindLabel, stepAction } from "./attribute-display";
import {
  chipTone,
  displayValue,
  filterByRoleView,
  flipped,
  type RoleView,
  roleLabel,
} from "./role-view";
import {
  durationLabel,
  resizeStepDuration,
  SNAP_OPTIONS,
  type SnapValue,
  snapTo,
  stepDuration,
} from "./timeline-ops";

export interface FigureTimelineProps {
  /** Membership role — only an editor can place/edit attributes. */
  role: MembershipRole;
  /** The dance, to scope the attribute registry + beat ruler (US-029). */
  dance?: DanceId;
  /** The figure's current attributes (controlled-with-fallback). */
  attributes?: Attribute[];
  /** Override the whole-count count (else dance-aware). */
  counts?: number;
  /** The viewed role lens (US-030); new values inherit it. */
  initialView?: "leader" | "follower";
  /** User-defined kinds to merge into the attribute registry (US-043). */
  customKinds?: RegistryKind[];
  /** Emits the figure's next full attribute set after an edit. */
  onChange?: (next: Attribute[]) => void;
  /** "owned" vs a non-owned global/shared figure ("global") — editing a global
   *  figure copies it to a variant (US-035). */
  figureScope?: "owned" | "global";
  /** Explicit "Fork into variant" action (US-036). */
  onForkIntoVariant?: () => void;
  /** The base figure's display name, for the "Variant of …" lineage badge. */
  baseName?: string;
}

/** Humanize a stored value for a roomy chip ("quarter_R" → "quarter R"). */
const humanize = (value: unknown): string => displayValue(value).replace(/_/g, " ");

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
  const attrs = attributes ?? [];
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [openExpanded, setOpenExpanded] = useState(false);
  const [view, setView] = useState<RoleView>(initialView ?? "leader");
  const [snap, setSnap] = useState<SnapValue>(0.125);
  const [copied, setCopied] = useState(false);
  const [forked, setForked] = useState(false);
  const isGlobal = figureScope === "global";
  const editable = role === "editor";

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

  // Sorted distinct counts that actually carry a step (for headlines + ordering).
  const placedCounts = useMemo(() => [...byCount.keys()].sort((a, b) => a - b), [byCount]);

  // Dance-aware beat ruler: the dance's phrase (Waltz 6 / 4-4 dances 8) grouped
  // into bars, extended to cover any attribute placed in a later phrase.
  const meta = dance ? DANCES[dance] : undefined;
  const beatsPerBar = meta?.beatsPerBar ?? 4;
  const phraseBeats = meta?.phraseBeats ?? 8;
  const timeSignature = meta?.timeSignature ?? "4/4";
  const bars = useMemo(() => {
    const live = attrs.filter((a) => a.deletedAt == null).map((a) => a.count);
    const maxWhole = live.reduce((m, c) => Math.max(m, Math.ceil(c)), 0);
    const phrases = dance ? barsForFigure(live, dance) : 1;
    const total = counts ?? Math.max(phraseBeats * phrases, maxWhole, beatsPerBar);
    const list = Array.from({ length: total }, (_, i) => i + 1);
    const grouped: number[][] = [];
    for (let i = 0; i < list.length; i += beatsPerBar) grouped.push(list.slice(i, i + beatsPerBar));
    return grouped;
  }, [attrs, counts, dance, phraseBeats, beatsPerBar]);

  const totalBeats = bars.reduce((n, b) => n + b.length, 0);

  // The technique kinds for this dance (drives the chip lane + ghost add-chips).
  // Direction is the headline, so it's excluded from the lane.
  const laneKinds = useMemo(() => {
    const reg = mergeRegistry(ATTRIBUTE_REGISTRY, customKinds);
    return Object.values(reg).filter(
      (k) =>
        k.kind !== "direction" &&
        (!k.appliesToDances || dance === undefined || k.appliesToDances.includes(dance)),
    );
  }, [customKinds, dance]);

  /** Replace one count's attributes within the full set + emit (COW on first
   *  edit of a non-owned global figure). */
  const onCountChange = (count: number, next: Attribute[]): void => {
    const others = attrs.filter((a) => a.count !== count || a.deletedAt != null);
    if (isGlobal && !copied) setCopied(true);
    onChange?.([...others, ...next]);
  };

  /** Open the per-count editor (optionally with the technique section expanded). */
  const open = (count: number, expanded = false): void => {
    setOpenExpanded(expanded);
    setOpenCount((cur) => (cur === count && !expanded ? null : count));
  };

  /** Resize the step at `count` to `newDuration` beats (snapped, ≥ one grid). */
  const resize = (count: number, newDuration: number): void => {
    const d = Math.max(snap, snapTo(newDuration));
    onChange?.(resizeStepDuration(attrs, count, d));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Control strip: meta + role lens + snap grid (design parity). */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2">
        <div className="flex items-center gap-2 text-2xs">
          <span className="font-bold text-ink">{timeSignature}</span>
          <span aria-hidden="true" className="text-ink-faint">
            ·
          </span>
          <span className="text-ink-muted">
            {bars.length} bars · {totalBeats} beats
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setView(flipped(view))}>
            {roleLabel(view)} · flip
          </Button>
          {editable && (
            <div className="flex items-center gap-0.5 rounded-md bg-surface p-0.5">
              {/* Snap grid — each option is labelled "Snap ¼/⅛/1". */}
              {SNAP_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={snap === o.value}
                  aria-label={`Snap ${o.label}`}
                  onClick={() => setSnap(o.value)}
                  className={cx(
                    "min-h-[28px] min-w-[28px] rounded px-2 text-2xs font-bold",
                    snap === o.value ? "bg-accent text-ink-inverse" : "text-ink-muted",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isGlobal && (
        <div className="flex flex-col gap-1">
          {(copied || forked) && (
            <p role="status" className="text-2xs text-accent">
              {forked ? `Variant of ${baseName ?? "the base figure"}` : "Copied as your variant"}
            </p>
          )}
          {editable && !forked && (
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

      {/* Bars → beat lanes → step cards. */}
      <div className="flex flex-col gap-4">
        {bars.map((bar, barIdx) => (
          <section
            key={`bar-${bar[0] ?? barIdx}`}
            aria-label={`bar ${barIdx + 1}`}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2 px-0.5">
              <span className="text-[9px] font-bold uppercase tracking-[1px] text-ink-faint">
                Bar {barIdx + 1}
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
            </div>
            {bar.map((beat) => {
              const inBeat = placedCounts.filter((c) => c >= beat && c < beat + 1);
              return (
                <div key={beat} className="flex items-start gap-2.5">
                  <button
                    type="button"
                    aria-label={`beat ${beat}`}
                    onClick={() => open(beat)}
                    className={cx(
                      "mt-0.5 flex size-[26px] flex-none cursor-pointer items-center justify-center",
                      "rounded-full bg-surface-sunken text-sm font-bold tabular-nums text-ink",
                    )}
                  >
                    {beat}
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {inBeat.length === 0 ? (
                      editable ? (
                        <AddStep onClick={() => open(beat)} label="Add step" />
                      ) : null
                    ) : (
                      inBeat.map((c) => (
                        <StepCard
                          key={c}
                          count={c}
                          orderIndex={placedCounts.indexOf(c)}
                          isLast={placedCounts.indexOf(c) === placedCounts.length - 1}
                          duration={stepDuration(c, placedCounts)}
                          attrs={filterByRoleView(byCount.get(c) ?? [], view)}
                          laneKinds={laneKinds}
                          editable={editable}
                          view={view}
                          selected={openCount === c}
                          snap={snap}
                          onOpen={(expanded) => open(c, expanded)}
                          onResize={(d) => resize(c, d)}
                        />
                      ))
                    )}
                    {/* Off-beat add: next grid position after this beat. */}
                    {editable && inBeat.length > 0 && (
                      <AddStep
                        onClick={() => open(snapTo(Math.max(...inBeat) + snap))}
                        label="Add off-beat"
                        subtle
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>

      {/* The per-count editor (design: a step-detail tag sheet). */}
      {openCount !== null && (
        <Card>
          {(() => {
            const here = filterByRoleView(byCount.get(openCount) ?? [], view);
            const direction = here.find((a) => a.kind === "direction");
            const orderIndex = placedCounts.indexOf(openCount);
            const slots = here.filter((a) => a.kind !== "direction");
            return (
              <div
                data-testid="step-summary"
                className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-3"
              >
                <span className="rounded-md bg-surface-sunken px-2 py-1 text-2xs font-bold text-ink">
                  {countLabel(openCount)}
                </span>
                <span className="text-2xs font-bold text-ink">
                  {stepAction(
                    orderIndex < 0 ? placedCounts.length : orderIndex,
                    view,
                    direction?.value,
                  )}
                </span>
                <span className="text-2xs text-ink-muted">
                  {durationLabel(stepDuration(openCount, placedCounts))}
                </span>
                {slots.map((a) => (
                  <span
                    key={a.id}
                    className="text-2xs text-ink-muted"
                    style={{ color: tokenForTone(chipTone(a.kind), "ink") }}
                  >
                    {humanize(a.value)}
                  </span>
                ))}
              </div>
            );
          })()}
          <AttributeEditor
            key={`${openCount}-${openExpanded}`}
            count={openCount}
            role={role}
            dance={dance}
            view={view}
            customKinds={customKinds}
            defaultExpanded={openExpanded}
            value={byCount.get(openCount) ?? []}
            onChange={(next) => onCountChange(openCount, next)}
          />
        </Card>
      )}
    </div>
  );
}

/** A token color for a chip tone (kind families or neutral). */
function tokenForTone(tone: AttributeKind | "neutral", role: "base" | "ink" | "tint") {
  if (tone === "neutral") {
    return role === "tint" ? "var(--bf-surface-sunken)" : "var(--bf-ink-secondary)";
  }
  return kindVar(tone, role);
}

interface StepCardProps {
  count: number;
  orderIndex: number;
  isLast: boolean;
  duration: number;
  attrs: Attribute[];
  laneKinds: RegistryKind[];
  editable: boolean;
  view: RoleView;
  selected: boolean;
  snap: SnapValue;
  onOpen: (expanded: boolean) => void;
  onResize: (duration: number) => void;
}

/** One step: headline + duration (resizable) + an attribute-chip lane. */
function StepCard({
  count,
  orderIndex,
  isLast,
  duration,
  attrs,
  laneKinds,
  editable,
  view,
  selected,
  snap,
  onOpen,
  onResize,
}: StepCardProps) {
  const direction = attrs.find((a) => a.kind === "direction");
  return (
    <div
      className={cx(
        "flex flex-col gap-2 rounded-[11px] border bg-surface-sunken/60 p-2.5",
        selected ? "border-accent" : "border-transparent",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid={`step-headline-${count}`}
          onClick={() => onOpen(false)}
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-xs font-bold text-ink"
        >
          {stepAction(orderIndex, view, direction?.value)}
        </button>
        <DurationPill
          count={count}
          duration={duration}
          editable={editable && !isLast}
          snap={snap}
          onResize={onResize}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {laneKinds.map((kind) => {
          const here = attrs.filter((a) => a.kind === kind.kind);
          if (here.length > 0) {
            return here.map((a) => (
              <AttrChip
                key={a.id}
                kind={kind}
                value={a.value}
                onClick={() => editable && onOpen(true)}
                editable={editable}
              />
            ));
          }
          return editable ? (
            <GhostChip key={kind.kind} label={kind.label} onClick={() => onOpen(true)} />
          ) : null;
        })}
      </div>
    </div>
  );
}

/** A set attribute chip: KIND label + value, tinted to the kind family. */
function AttrChip({
  kind,
  value,
  onClick,
  editable,
}: {
  kind: RegistryKind;
  value: unknown;
  onClick: () => void;
  editable: boolean;
}) {
  const tone = chipTone(kind.kind);
  const style = {
    background: tokenForTone(tone, "tint"),
    borderColor: tone === "neutral" ? "var(--bf-border-strong)" : kindVar(tone),
  };
  const Tag = editable ? "button" : "span";
  return (
    <Tag
      type={editable ? "button" : undefined}
      onClick={editable ? onClick : undefined}
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5",
        editable && "cursor-pointer",
      )}
      style={style}
    >
      <span
        className="text-[7px] font-bold uppercase tracking-[0.5px]"
        style={{ color: tokenForTone(tone, "base") }}
      >
        {shortKindLabel(kind.label)}
      </span>
      <span className="text-[10px] font-bold leading-none text-ink">{humanize(value)}</span>
    </Tag>
  );
}

/** A ghost add-chip for an empty attribute kind ("+ rise"). */
function GhostChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Add ${label}`}
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-border-strong px-1.5 py-1 text-2xs font-bold text-ink-faint"
    >
      <PlusIcon size={8} />
      <span className="lowercase">{shortKindLabel(label)}</span>
    </button>
  );
}

/** The duration pill — a resizable slider (keyboard + pointer drag). */
function DurationPill({
  count,
  duration,
  editable,
  snap,
  onResize,
}: {
  count: number;
  duration: number;
  editable: boolean;
  snap: SnapValue;
  onResize: (duration: number) => void;
}) {
  const label = durationLabel(duration);
  if (!editable) {
    return (
      <span className="flex-none rounded-md bg-surface px-1.5 py-0.5 text-2xs font-bold text-ink-muted">
        {label}
      </span>
    );
  }
  // Pointer drag: ~24px per grid step; commit on each crossed step.
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startDur = duration;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const steps = Math.round((ev.clientX - startX) / 24);
      onResize(startDur + steps * snap);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onResize(duration + snap);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onResize(duration - snap);
    }
  };
  return (
    <button
      type="button"
      role="slider"
      aria-label={`Resize step ${countLabel(count)}`}
      aria-valuenow={duration}
      aria-valuemin={snap}
      aria-valuetext={label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="flex-none cursor-ew-resize touch-none rounded-md bg-surface px-1.5 py-0.5 text-2xs font-bold text-ink-muted"
    >
      {label}
    </button>
  );
}

/** A dashed "+ Add step" affordance for an empty beat / off-beat. */
function AddStep({
  onClick,
  label,
  subtle,
}: {
  onClick: () => void;
  label: string;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex items-center justify-center gap-1 rounded-[11px] border border-dashed border-border-strong py-2 text-2xs font-bold",
        subtle ? "text-ink-faint" : "text-ink-muted",
      )}
    >
      <PlusIcon size={12} />
      {label}
    </button>
  );
}
