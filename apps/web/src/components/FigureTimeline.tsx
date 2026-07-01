// US-028 / US-030 — the figure timeline (the hero flow). PLAN §4.4/§4.5, §1.5.
// 2026-07-01 design update (frames 1.11 figure editor / 1.12 attribute editor):
// the EDIT view is a BARS-DRIVEN column grid. Its rows are generated from the
// figure's authored bar count — NOT from the steps it already has — so every
// place a value could go is shown: for each bar → each beat (1..beatsPerBar) →
// the whole beat, then its e (¼), & (½), a (¾) sub-beats. Whole beats read solid,
// sub-beats dimmed; a "bar N" divider precedes each bar. Columns are every
// attribute kind applicable to the dance (Step* required, then Rise · Pos · Feet ·
// Body · Sway · Turn · custom). A cell shows an AttrChip for a set value or a
// faint ＋; TAPPING ANY CELL opens a focused SINGLE-ATTRIBUTE overlay (frame 1.12)
// for exactly that (timing, attribute) — not a per-count wall of every kind.
//
// The figure's length is explicit: a "− N bars +" stepper in the header sets it
// (US-004). Empty sub-beat/whole-beat slots are placeholders — a value written to
// one creates the moment on demand at the right count (order preserved).
//
// Everything AUTO-SAVES (edits emit `onChange`/`onBarsChange` immediately; an undo
// exists) — there is no figure-level Save. The per-attribute overlay carries only
// a Save (confirm + close) and Remove (clear) for that one attribute.
//
// Role is a VIEW, not an identity (US-030, principle #25): a per-device lens (the
// "Steps for" toggle), never a stored role. role=null ("both") always shows;
// role values show only for the selected lens.
//
// Fully controlled (#151): the rendered attributes/bars derive from props; edits
// go out via callbacks and return as the next props. Only transient UI (open
// cell, lens, info column) is local state.

import {
  type Attribute,
  countLabel,
  DANCES,
  type DanceId,
  defaultFigureBars,
  figureGridSlots,
  type GridSlot,
  offBeatSymbol,
  type RegistryKind,
} from "@ballroom/domain";
import { type ReactNode, useMemo, useState } from "react";
import { AttrChip, Button, cx, kindVar, SegmentedToggle, Sheet, Stepper } from "../ui";
import type { MembershipRole } from "./Assemble";
import { AttributeEditor } from "./AttributeEditor";
import { AttributeInfoSheet } from "./AttributeInfoSheet";
import { stepAction } from "./attribute-display";
import {
  allColumns,
  cellValue,
  columnUsage,
  infoKindsForColumn,
  type ReadingColumn,
} from "./reading-columns";
import { displayValue, filterByRoleView, type RoleView } from "./role-view";

export interface FigureTimelineProps {
  /** Membership role — only an editor can place/edit attributes. */
  role: MembershipRole;
  /** The dance, to scope the attribute registry, beat grouping + grid (US-029). */
  dance?: DanceId;
  /** The figure's current attributes (controlled-with-fallback). */
  attributes?: Attribute[];
  /** The figure's authored length in musical bars (drives the generated grid).
   *  Falls back to ⌈whole-beat steps ÷ beatsPerBar⌉ when omitted. */
  bars?: number;
  /** Emits the next bar count when the header stepper is used (editor only). */
  onBarsChange?: (next: number) => void;
  /** The viewed role lens (US-030); new values inherit it. Uncontrolled default. */
  initialView?: "leader" | "follower";
  /** Controlled role lens (QUAL-5): when set, the lens is owned by the caller —
   *  wired to the store-persisted `bb_role` so reading/timeline/lanes agree. */
  roleView?: RoleView;
  /** Emits the next role lens when the toggle is used (controlled mode). */
  onRoleViewChange?: (next: RoleView) => void;
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
  /** The choreo/figure name, for the attribute info sheet footer (frame 1.13). */
  scopeLabel?: string;
}

/** Humanize a stored value for a roomy chip ("quarter_R" → "quarter R"). */
const humanize = (value: unknown): string => displayValue(value).replace(/_/g, " ");

/** Vulgar-fraction words for a sub-beat's overlay title (frame 1.12). */
const SUB_BEAT_VULGAR: Record<string, string> = { e: "¼", "&": "½", a: "¾" };

/**
 * The attribute-overlay title for a timing (frame 1.12): a whole beat reads
 * "count N"; a sub-beat reads "the & (½ beat)" (the symbol + its fraction).
 */
function timingTitle(count: number): string {
  if (Number.isInteger(count)) return `count ${count}`;
  const symbol = offBeatSymbol(count) ?? "";
  const vulgar = SUB_BEAT_VULGAR[symbol];
  return vulgar ? `the ${symbol} (${vulgar} beat)` : `count ${countLabel(count)}`;
}

/** The registry kind(s) a column's overlay edits: the merged Step column edits
 *  direction + footwork; every other column edits its single kind. */
function columnKinds(col: ReadingColumn): string[] {
  return col.isStep ? ["direction", "footwork"] : [col.kind];
}

/** A column's header/text color — the kind's base token, slate for custom. */
function columnColor(col: ReadingColumn): string {
  const standard = [
    "direction",
    "footwork",
    "footPosition",
    "rise",
    "position",
    "bodyActions",
    "sway",
    "turn",
  ];
  return standard.includes(col.kind)
    ? kindVar(col.kind as Parameters<typeof kindVar>[0])
    : "var(--bf-ink-secondary)";
}

export function FigureTimeline({
  role,
  dance,
  attributes,
  bars,
  onBarsChange,
  initialView,
  roleView,
  onRoleViewChange,
  customKinds = [],
  onChange,
  figureScope,
  onForkIntoVariant,
  baseName,
  scopeLabel,
}: FigureTimelineProps) {
  const attrs = attributes ?? [];
  // The open attribute overlay: a (timing, column) target, or null (frame 1.12).
  const [openCell, setOpenCell] = useState<{ count: number; column: ReadingColumn } | null>(null);
  // The column whose attribute info overlay is open (frame 1.13). Tapping a column
  // HEADER opens the plain-language reference; tapping a cell opens the editor.
  const [infoCol, setInfoCol] = useState<ReadingColumn | null>(null);
  // Role lens: controlled by `roleView` (QUAL-5, wired to the store-persisted
  // `bb_role`) when provided; otherwise local UI state seeded from initialView.
  const [localView, setLocalView] = useState<RoleView>(roleView ?? initialView ?? "leader");
  const view = roleView ?? localView;
  const setView = (next: RoleView): void => {
    onRoleViewChange?.(next);
    if (roleView === undefined) setLocalView(next);
  };
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

  // Sorted distinct counts that actually carry a value (for out-of-grid rows).
  const placedCounts = useMemo(() => [...byCount.keys()].sort((a, b) => a - b), [byCount]);

  const gridDance = (dance ?? "waltz") as DanceId;
  const beatsPerBar = DANCES[gridDance].beatsPerBar;
  // The figure's authored length: the explicit `bars` prop, else the default from
  // its whole-beat steps. Clamped so the stepper never drops below one bar.
  const liveAttrs = useMemo(() => attrs.filter((a) => a.deletedAt == null), [attrs]);
  const resolvedBars = Math.max(1, bars ?? defaultFigureBars(liveAttrs, gridDance));

  // The grid columns: every kind applicable to the dance (all-applicable, so empty
  // cells are addable) — the EDIT counterpart to the reading view's used-columns.
  const columns = useMemo(() => allColumns(dance, customKinds), [dance, customKinds]);
  const colorByKind = useMemo(() => {
    const map = new Map<string, string>();
    for (const k of customKinds) map.set(k.kind, k.color);
    return map;
  }, [customKinds]);

  // The grid rows: EVERY timing the bar count allows (bar → beat → e/&/a),
  // generated from `bars` (US-028) — plus any attribute placed OUTSIDE that range
  // (e.g. a step left beyond a since-shrunk bar count) so no value is ever hidden.
  const rows = useMemo(() => {
    const slots = figureGridSlots(resolvedBars, gridDance);
    const inGrid = new Set(slots.map((s) => s.count));
    const extras: GridSlot[] = placedCounts
      .filter((c) => !inGrid.has(c))
      .map((c) => ({
        count: c,
        label: countLabel(c),
        bar: Math.max(1, Math.ceil(Math.floor(c) / beatsPerBar)),
        beat: Math.floor(c),
        whole: Number.isInteger(c),
      }));
    return [...slots, ...extras].sort((a, b) => a.count - b.count);
  }, [resolvedBars, gridDance, beatsPerBar, placedCounts]);

  /** Replace one count's attributes within the full set + emit (COW on first
   *  edit of a non-owned global figure). */
  const onCountChange = (count: number, next: Attribute[]): void => {
    const others = attrs.filter((a) => a.count !== count || a.deletedAt != null);
    if (isGlobal && !copied) setCopied(true);
    onChange?.([...others, ...next]);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header controls: the "− N bars +" length stepper (editor only) + the
          "Steps for" role lens (frame 1.11). The lens is a per-device VIEW. */}
      <div className="flex flex-wrap items-center gap-3">
        {editable && onBarsChange && (
          <Stepper
            label="Bars"
            hideLabel
            unit="bars"
            min={1}
            max={32}
            value={resolvedBars}
            onChange={(next) => onBarsChange(next)}
          />
        )}
        <div className="flex items-center gap-2">
          <span className="text-2xs font-bold uppercase tracking-wider text-ink-muted">
            Steps for
          </span>
          <SegmentedToggle<RoleView>
            ariaLabel="Steps for"
            value={view}
            onChange={setView}
            options={[
              { value: "leader", label: "Leader" },
              { value: "follower", label: "Follower" },
            ]}
          />
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

      {/* The column grid: sticky count column + one column per applicable kind,
          grouped into bars (a "bar N" divider precedes each bar's beats). */}
      <div className="overflow-x-auto">
        <table className="w-max border-separate border-spacing-y-1" aria-label="Step grid">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-surface">
                <span className="bf-sr-only">Count</span>
              </th>
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  className="px-1.5 pb-1 text-center text-[10px] font-bold"
                  style={{ color: columnColor(col) }}
                >
                  <button
                    type="button"
                    aria-label={`About ${col.label}`}
                    onClick={() => setInfoCol(col)}
                    className="cursor-pointer"
                    style={{ color: "inherit" }}
                  >
                    {col.label}
                    {col.isStep && <span aria-hidden="true">*</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const newBar = i === 0 || rows[i - 1]?.bar !== row.bar;
              const here = filterByRoleView(byCount.get(row.count) ?? [], view);
              return (
                <BarRowGroup
                  key={row.count}
                  showDivider={newBar}
                  bar={row.bar}
                  span={columns.length}
                >
                  <tr>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-surface p-0 pr-1.5 align-middle"
                    >
                      <CountCell label={row.label} offBeat={!row.whole} />
                    </th>
                    {columns.map((col) => (
                      <td key={col.id} className="px-0.5 align-middle">
                        <GridCell
                          column={col}
                          count={row.count}
                          label={cellValue(here, col)}
                          offBeat={!row.whole}
                          editable={editable}
                          color={colorByKind.get(col.kind)}
                          onOpen={() => setOpenCell({ count: row.count, column: col })}
                        />
                      </td>
                    ))}
                  </tr>
                </BarRowGroup>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Helper caption (frame 1.11). */}
      <p className="text-2xs italic text-ink-faint">
        tap a cell to add / edit one attribute · * required · scroll → Head &amp; custom types
      </p>

      {/* Always-visible per-count recap (the headline word + this count's value
          words) — the readable summary the authoring journey reads, present as soon
          as the figure opens. */}
      {rows.map((row) => {
        const here = filterByRoleView(byCount.get(row.count) ?? [], view);
        if (here.length === 0) return null;
        const direction = here.find((a) => a.kind === "direction");
        const slots = here.filter((a) => a.kind !== "direction");
        return (
          <div
            key={`detail-${row.count}`}
            data-testid={`step-detail-${row.count}`}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="rounded-md bg-surface-sunken px-2 py-1 text-2xs font-bold tabular-nums text-ink">
              {row.label}
            </span>
            <span
              data-testid={`step-headline-${row.count}`}
              className="text-2xs font-bold text-ink"
            >
              {stepAction(direction?.value)}
            </span>
            <ul
              aria-label={`count ${row.count} attributes`}
              className="flex flex-wrap items-center gap-2"
            >
              {slots.map((a) => (
                <li key={a.id} className="text-2xs text-ink-muted">
                  {humanize(a.value)}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {/* The single-attribute overlay (frame 1.12): title = the timing, meta = the
          attribute name; body = ONLY that column's kind(s); Save confirms, Remove
          clears. Opened by tapping a cell. */}
      {openCell && (
        <Sheet
          open
          onClose={() => setOpenCell(null)}
          title={timingTitle(openCell.count)}
          meta={openCell.column.label}
        >
          <AttributeEditor
            key={`${openCell.count}-${openCell.column.id}`}
            count={openCell.count}
            role={role}
            dance={dance}
            view={view}
            customKinds={customKinds}
            onlyKinds={columnKinds(openCell.column)}
            value={byCount.get(openCell.count) ?? []}
            figureAttributes={attrs}
            scopeLabel={scopeLabel}
            onChange={(next) => onCountChange(openCell.count, next)}
            onDone={() => setOpenCell(null)}
          />
        </Sheet>
      )}

      {/* The attribute info overlay (frame 1.13) — opened by tapping a column
          header. The merged Step column describes both direction + footwork. */}
      {infoCol &&
        (() => {
          const live = attrs.filter((a) => a.deletedAt == null);
          const [primary, ...rest] = infoKindsForColumn(infoCol, customKinds, live);
          if (!primary) return null;
          return (
            <AttributeInfoSheet
              open
              kind={primary}
              extraKinds={rest}
              title={infoCol.isStep ? infoCol.label : undefined}
              usageCount={columnUsage(live, [primary, ...rest])}
              scopeLabel={scopeLabel}
              onClose={() => setInfoCol(null)}
            />
          );
        })()}
    </div>
  );
}

/** Wrap a grid row in a "bar N" divider row when it starts a new bar (frame 1.11:
 *  bar dividers group the beats). The divider is a full-width labelled row. */
function BarRowGroup({
  showDivider,
  bar,
  span,
  children,
}: {
  showDivider: boolean;
  bar: number;
  span: number;
  children: ReactNode;
}) {
  return (
    <>
      {showDivider && (
        <tr>
          <td
            colSpan={span + 1}
            className="pt-2 pb-0.5 text-2xs font-bold uppercase tracking-wider text-ink-faint"
          >
            bar {bar}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}

/** The sticky left count cell — a static beat token (frame 1.11). The row header,
 *  tinted to the direction family; off-beat (sub-beat) rows read dimmed. */
function CountCell({ label, offBeat }: { label: string; offBeat: boolean }) {
  return (
    <span
      className="flex h-[34px] w-[34px] items-center justify-center rounded-md text-sm font-bold tabular-nums"
      style={{
        background: "var(--bf-kind-direction-tint)",
        color: offBeat ? "var(--bf-offbeat-ink)" : "var(--bf-kind-direction-ink)",
        opacity: offBeat ? 0.7 : undefined,
      }}
    >
      {label}
    </span>
  );
}

/** One grid cell: a filled AttrChip (Step = merged direction·footwork) or a faint
 *  ＋ placeholder. Tapping a filled cell edits; tapping a ＋ adds. */
function GridCell({
  column,
  count,
  label,
  offBeat,
  editable,
  color,
  onOpen,
}: {
  column: ReadingColumn;
  count: number;
  label: string | null;
  offBeat: boolean;
  editable: boolean;
  color?: string;
  onOpen: () => void;
}) {
  const verb = label ? "Edit" : "Add";
  const cellLabel = `${verb} ${column.label} at count ${countLabel(count)}`;
  const content = label ? (
    <AttrChip kind={column.kind} label={label} color={color} dimmed={offBeat} />
  ) : (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center text-sm font-bold text-ink-faint"
    >
      ＋
    </span>
  );
  const base = "flex min-h-[34px] w-[68px] items-center justify-center rounded-md";
  const fillStyle = { background: label ? undefined : "var(--bf-surface-sunken)" };
  if (!editable) {
    // Read grid: values only, no add affordances.
    return label ? (
      <span className={base}>{content}</span>
    ) : (
      <span className={base} style={fillStyle} aria-hidden="true" />
    );
  }
  return (
    <button
      type="button"
      aria-label={cellLabel}
      onClick={onOpen}
      className={cx(base, "cursor-pointer")}
      style={fillStyle}
    >
      {content}
    </button>
  );
}
