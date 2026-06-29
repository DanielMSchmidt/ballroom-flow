// US-028 / US-030 — the figure timeline (the hero flow). PLAN §4.4/§4.5, §1.5.
// 2026-06-29 design parity (frame 1.11 "Figure detail EDIT grid"): the EDIT view
// is a scrollable COLUMN GRID — a sticky count column on the left (count cell
// tinted to the direction family; off-beat rows dimmed) and one column per
// attribute kind APPLICABLE to the figure's dance (Step* required, then Rise ·
// Pos · Sway · Turn · Body · custom). A cell shows an AttrChip when the count
// carries that kind's value (the Step cell merges direction + footwork, e.g.
// "fwd·B"), else a faint ＋ placeholder. Tapping any cell opens the per-count
// AttributeEditor (a filled cell edits, a ＋ adds). A dashed "＋ add an
// in-between timing" reveals an on-count chooser to place a sub-beat.
//
// Unlike the READING view (only-used columns), the EDIT grid shows every
// applicable kind so empty cells are addable — `allColumns` honors
// `appliesToDances` (Tango omits Rise), shared with the reading-view column model.
//
// Role is a VIEW, not an identity (US-030, principle #25): a per-device lens
// (the "Steps for" SegmentedToggle), never a stored role. role=null ("both")
// values always show; role values show only for the selected lens.
//
// Fully controlled (#151): the rendered attributes derive from the `attributes`
// prop; edits go out via `onChange` and return as the next prop. Only transient
// UI (open count, lens, chooser) is local state. The RENDER changed here, not the
// timing model — float counts are untouched.

import {
  type Attribute,
  barsForFigure,
  countLabel,
  DANCES,
  type DanceId,
  type RegistryKind,
} from "@ballroom/domain";
import { useMemo, useState } from "react";
import { AttrChip, Button, Card, cx, kindVar, PlusIcon, SegmentedToggle } from "../ui";
import type { MembershipRole } from "./Assemble";
import { AttributeEditor } from "./AttributeEditor";
import { stepAction } from "./attribute-display";
import { allColumns, cellValue, isOffBeatCount, type ReadingColumn } from "./reading-columns";
import { displayValue, filterByRoleView, type RoleView } from "./role-view";

export interface FigureTimelineProps {
  /** Membership role — only an editor can place/edit attributes. */
  role: MembershipRole;
  /** The dance, to scope the attribute registry + beat ruler (US-029). */
  dance?: DanceId;
  /** The figure's current attributes (controlled-with-fallback). */
  attributes?: Attribute[];
  /** Override the whole-count count (else dance-aware). */
  counts?: number;
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

/** A column's header/text color — the kind's base token, slate for custom. */
function columnColor(col: ReadingColumn): string {
  const standard = ["direction", "footwork", "rise", "position", "sway", "turn"];
  return standard.includes(col.kind)
    ? kindVar(col.kind as Parameters<typeof kindVar>[0])
    : "var(--bf-ink-secondary)";
}

export function FigureTimeline({
  role,
  dance,
  attributes,
  counts,
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
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [openExpanded, setOpenExpanded] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
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

  // Sorted distinct counts that actually carry a value (drives off-beat rows).
  const placedCounts = useMemo(() => [...byCount.keys()].sort((a, b) => a - b), [byCount]);

  // Dance-aware beat ruler: the dance's phrase (Waltz 6 / 4-4 dances 8), extended
  // to cover any attribute placed in a later phrase. Drives the whole-beat rows.
  const meta = dance ? DANCES[dance] : undefined;
  const beatsPerBar = meta?.beatsPerBar ?? 4;
  const phraseBeats = meta?.phraseBeats ?? 8;
  const totalBeats = useMemo(() => {
    const live = attrs.filter((a) => a.deletedAt == null).map((a) => a.count);
    const maxWhole = live.reduce((m, c) => Math.max(m, Math.ceil(c)), 0);
    const phrases = dance ? barsForFigure(live, dance) : 1;
    return counts ?? Math.max(phraseBeats * phrases, maxWhole, beatsPerBar);
  }, [attrs, counts, dance, phraseBeats, beatsPerBar]);

  // The grid columns: every kind applicable to the dance (all-applicable, so empty
  // cells are addable) — the EDIT counterpart to the reading view's used-columns.
  const columns = useMemo(() => allColumns(dance, customKinds), [dance, customKinds]);
  const colorByKind = useMemo(() => {
    const map = new Map<string, string>();
    for (const k of customKinds) map.set(k.kind, k.color);
    return map;
  }, [customKinds]);

  // The grid rows: every whole beat of the ruler, plus any placed off-beat counts,
  // in count order. Whole beats give the addable ruler; off-beats appear once used.
  const rowCounts = useMemo(() => {
    const set = new Set<number>();
    for (let b = 1; b <= totalBeats; b++) set.add(b);
    for (const c of placedCounts) if (isOffBeatCount(c)) set.add(c);
    return [...set].sort((a, b) => a - b);
  }, [totalBeats, placedCounts]);

  // Candidate in-between (sub-beat) positions for the chooser: the "&" of each
  // whole beat that isn't already a row.
  const offBeatChoices = useMemo(() => {
    const present = new Set(rowCounts);
    const out: number[] = [];
    for (let b = 1; b <= totalBeats; b++) if (!present.has(b + 0.5)) out.push(b + 0.5);
    return out;
  }, [rowCounts, totalBeats]);

  /** Replace one count's attributes within the full set + emit (COW on first
   *  edit of a non-owned global figure). */
  const onCountChange = (count: number, next: Attribute[]): void => {
    const others = attrs.filter((a) => a.count !== count || a.deletedAt != null);
    if (isGlobal && !copied) setCopied(true);
    onChange?.([...others, ...next]);
  };

  /** Open the per-count editor (optionally with the technique section expanded —
   *  set when adding via a non-identity column cell). */
  const open = (count: number, expanded = false): void => {
    setOpenExpanded(expanded);
    setOpenCount((cur) => (cur === count && !expanded ? null : count));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* "Steps for" role lens (frame 1.11). A per-device VIEW, not a stored role. */}
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

      {/* The column grid: sticky count column + one column per applicable kind. */}
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
                  {col.label}
                  {col.isStep && <span aria-hidden="true">*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowCounts.map((count) => {
              const offBeat = isOffBeatCount(count);
              const here = filterByRoleView(byCount.get(count) ?? [], view);
              return (
                <tr key={count}>
                  <th scope="row" className="sticky left-0 z-10 bg-surface p-0 pr-1.5 align-middle">
                    <CountCell
                      count={count}
                      offBeat={offBeat}
                      selected={openCount === count}
                      onOpen={() => open(count)}
                    />
                  </th>
                  {columns.map((col) => (
                    <td key={col.id} className="px-0.5 align-middle">
                      <GridCell
                        column={col}
                        count={count}
                        label={cellValue(here, col)}
                        offBeat={offBeat}
                        editable={editable}
                        color={colorByKind.get(col.kind)}
                        onOpen={() => open(count, !col.isStep)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add a sub-beat ("in-between timing") — frame 1.11's dashed affordance +
          on-count chooser. */}
      {editable && offBeatChoices.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={chooserOpen}
            onClick={() => setChooserOpen((o) => !o)}
            className="flex items-center justify-center gap-1.5 rounded-[11px] border border-dashed border-border-strong py-2.5 text-2xs font-bold text-ink-muted"
          >
            <PlusIcon size={12} />
            add an in-between timing
          </button>
          {chooserOpen && (
            <div className="flex flex-wrap gap-1.5">
              {offBeatChoices.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`add in-between count ${countLabel(c)}`}
                  onClick={() => {
                    setChooserOpen(false);
                    open(c);
                  }}
                  className="min-h-[32px] rounded-md bg-surface-sunken px-3 text-2xs font-bold tabular-nums text-ink"
                >
                  {countLabel(c)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Helper caption (frame 1.11). */}
      <p className="text-2xs italic text-ink-faint">
        tap a cell to add / edit · * required · scroll → Head &amp; custom types
      </p>

      {/* The per-count editor (frame 1.12). The summary above it carries the step
          headline + this count's value chips — the contract the authoring journey
          reads (step-headline-N, "count N attributes"). */}
      {openCount !== null && (
        <Card>
          {(() => {
            const here = filterByRoleView(byCount.get(openCount) ?? [], view);
            const direction = here.find((a) => a.kind === "direction");
            const slots = here.filter((a) => a.kind !== "direction");
            return (
              <div
                data-testid="step-summary"
                className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-3"
              >
                <span className="rounded-md bg-surface-sunken px-2 py-1 text-2xs font-bold text-ink">
                  {countLabel(openCount)}
                </span>
                <span
                  data-testid={`step-headline-${openCount}`}
                  className="text-2xs font-bold text-ink"
                >
                  {stepAction(direction?.value)}
                </span>
                <ul
                  aria-label={`count ${openCount} attributes`}
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
            figureAttributes={attrs}
            scopeLabel={scopeLabel}
            onChange={(next) => onCountChange(openCount, next)}
          />
        </Card>
      )}
    </div>
  );
}

/** The sticky left count cell — a tappable beat token (frame 1.11) that opens the
 *  per-count editor (read-only for a viewer). The count column is tinted to the
 *  direction family; off-beat rows read dimmed. */
function CountCell({
  count,
  offBeat,
  selected,
  onOpen,
}: {
  count: number;
  offBeat: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`beat ${countLabel(count)}`}
      onClick={onOpen}
      className={cx(
        "flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-md",
        "text-sm font-bold tabular-nums",
        selected && "ring-2 ring-accent",
      )}
      style={{
        background: "var(--bf-kind-direction-tint)",
        color: offBeat ? "var(--bf-offbeat-ink)" : "var(--bf-kind-direction-ink)",
        opacity: offBeat ? 0.7 : undefined,
      }}
    >
      {countLabel(count)}
    </button>
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
