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
// Everything AUTO-SAVES (edits emit `onChange`/`onBarsChange` immediately) — there
// is no figure-level Save. The safety net is the editor header's Undo/Redo, wired
// by the Assemble FullScreen host to `store.undoFigure`/`redoFigure` so it targets
// THIS figure's own doc (§5.4, "undo follows the surface being edited") — a mis-tap
// in the grid is recoverable. The per-attribute overlay carries only a Save (confirm
// + close) and Remove (clear) for that one attribute.
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
  figureCountSlots,
  type GridSlot,
  isBothConsistent,
  mergeRegistry,
  offBeatSymbol,
  type PlacementPart,
  phraseCountLabel,
  type RegistryKind,
  resolveFigureCounts,
  windowAttributes,
} from "@weavesteps/domain";
import { type ReactNode, useMemo, useState } from "react";
import { getLocale, localizedRegistry, pickMessages, useLocale, useMessages } from "../i18n";
import { timelineMessages } from "../i18n/messages/timeline";
import { AttrChip, Button, cx, kindVar, SegmentedToggle, Sheet, Stepper, useToast } from "../ui";
import type { MembershipRole } from "./Assemble";
import { AttributeEditor } from "./AttributeEditor";
import { AttributeInfoSheet } from "./AttributeInfoSheet";
import { stepAction } from "./attribute-display";
import {
  allColumns,
  cellValue,
  columnUsage,
  infoKindsForColumn,
  isColumnKind,
  type ReadingColumn,
} from "./reading-columns";
import { asReadView, displayValue, type EditRoleView, filterByRoleView } from "./role-view";

export interface FigureTimelineProps {
  /** Membership role — only an editor can place/edit attributes. */
  role: MembershipRole;
  /** The dance, to scope the attribute registry, beat grouping + grid (US-029). */
  dance?: DanceId;
  /** The figure's current attributes (controlled-with-fallback). */
  attributes?: Attribute[];
  /** The figure's authored length in COUNTS (beats, 1–64 — Builder v3 ①; drives
   *  the generated grid). Falls back to `legacyBars × beatsPerBar`, then to a
   *  bar's worth of beats for an empty figure / the step default otherwise. */
  counts?: number;
  /** A pre-v5 doc's authored length in whole bars (lenient read only). */
  legacyBars?: number;
  /** Emits the next count length when the header LENGTH stepper is used (editor only). */
  onCountsChange?: (next: number) => void;
  /** The role lens (US-030/WEP-0005); the WRITE SCOPE while editing. Uncontrolled default. */
  initialView?: EditRoleView;
  /** Controlled role lens (QUAL-5): when set, the lens is owned by the caller —
   *  wired to the store-persisted `bb_role` so reading/timeline/lanes agree. */
  roleView?: EditRoleView;
  /** Emits the next role lens when the toggle is used (controlled mode). */
  onRoleViewChange?: (next: EditRoleView) => void;
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
  /** Whether this (account) figure is already in the caller's library (⟳v5, §4.2/§5.2). */
  isBookmarked?: boolean;
  /** Bookmark this figure into the caller's library — shown for an OWNED (account)
   *  figure only; a "↟ save" on a global figure lives on the Library screen instead. */
  onAddToLibrary?: () => void;
  /** The figure's display name — drives the "adjusted for this choreo — still X"
   *  identity reassurance beside Add to library (Builder v3 variant bar). */
  figureName?: string;
  /** The design's variantBar.adjusted flag: the figure HAS an origin (a base /
   *  catalog identity) it was adjusted away from. Gates the "adjusted for this
   *  choreo — still X" chip — a from-scratch custom (no origin) must NOT show
   *  it: nothing was ever adjusted. Default false (the chip is opt-in). */
  adjusted?: boolean;
  /** Rename the LIVE figure doc (Builder v3 ⑤): the add-to-library naming flow
   *  writes the typed name onto the shared doc before bookmarking. */
  onRenameFigure?: (name: string) => void;
  /** The placement's portion window (Builder v3 ③, §4.3): when set, the editor
   *  windows its grid to counts [fromCount, toCount] — the placement dances only
   *  that slice, so only those beats are shown and editable here. The figure doc
   *  stays whole (edits merge back into the full timeline; §4.4). No `part` = the
   *  whole figure. The window is FIXED — the LENGTH stepper is hidden. */
  part?: PlacementPart | null;
  /** Whether to render the per-count text recap under the grid (the authoring
   *  summary). Default true; the Assemble reading lens turns it off — when
   *  viewing, the grid/chips ARE the content and the prose recap is noise
   *  (owner request 2026-07-08). */
  showStepRecap?: boolean;
}

/** Humanize a stored value for a roomy chip ("quarter_R" → "quarter R"). */
const humanize = (value: unknown): string => displayValue(value).replace(/_/g, " ");

/** Vulgar-fraction words for a sub-beat's overlay title (frame 1.12). */
const SUB_BEAT_VULGAR: Record<string, string> = { e: "¼", "&": "½", a: "¾" };

/**
 * The attribute-overlay title for a timing (frame 1.12): a whole beat reads
 * "count N"; a sub-beat reads "the & (½ beat)" (the symbol + its fraction).
 * The beat number wraps at the dance's phrase (phraseCountLabel) so the title
 * agrees with the visible row label — a Waltz beat 7 opens as "count 1".
 */
function timingTitle(count: number, dance: DanceId): string {
  const t = pickMessages(timelineMessages);
  if (Number.isInteger(count)) return t.countN(phraseCountLabel(count, dance));
  const symbol = offBeatSymbol(count) ?? "";
  const vulgar = SUB_BEAT_VULGAR[symbol];
  return vulgar ? t.subBeatTitle(symbol, vulgar) : t.countN(phraseCountLabel(count, dance));
}

/** The registry kind(s) a column's overlay edits: the merged Step column edits
 *  direction + footwork; every other column edits its single kind. */
function columnKinds(col: ReadingColumn): string[] {
  return col.isStep ? ["direction", "footwork"] : [col.kind];
}

/** A column's header/text color — the kind's base token, slate for custom. */
function columnColor(col: ReadingColumn): string {
  return isColumnKind(col.kind) ? kindVar(col.kind) : "var(--bf-ink-secondary)";
}

export function FigureTimeline({
  role,
  dance,
  attributes,
  counts,
  legacyBars,
  onCountsChange,
  initialView,
  roleView,
  onRoleViewChange,
  customKinds = [],
  onChange,
  figureScope,
  onForkIntoVariant,
  baseName,
  scopeLabel,
  isBookmarked = false,
  onAddToLibrary,
  figureName,
  adjusted = false,
  onRenameFigure,
  part,
  showStepRecap = true,
}: FigureTimelineProps) {
  const t = useMessages(timelineMessages);
  const locale = useLocale();
  const toast = useToast();
  const attrs = attributes ?? [];
  // The open attribute overlay: a (timing, column) target, or null (frame 1.12).
  const [openCell, setOpenCell] = useState<{ count: number; column: ReadingColumn } | null>(null);
  // The column whose attribute info overlay is open (frame 1.13). Tapping a column
  // HEADER opens the plain-language reference; tapping a cell opens the editor.
  const [infoCol, setInfoCol] = useState<ReadingColumn | null>(null);
  // Role lens: controlled by `roleView` (QUAL-5, wired to the store-persisted
  // `bb_role`) when provided; otherwise local UI state seeded from initialView.
  const [localView, setLocalView] = useState<EditRoleView>(roleView ?? initialView ?? "leader");
  const view = roleView ?? localView;
  const setView = (next: EditRoleView): void => {
    onRoleViewChange?.(next);
    if (roleView === undefined) setLocalView(next);
  };
  const [copied, setCopied] = useState(false);
  const [forked, setForked] = useState(false);
  // The in-flight add-to-library naming draft (Builder v3 ⑤), or null.
  const [libraryName, setLibraryName] = useState<string | null>(null);
  const isGlobal = figureScope === "global";
  const editable = role === "editor";
  // WEP-0005: "both" is an EDIT-ONLY lens (the write scope) — a stored "both"
  // reads as the leader's chart, and the grid always DISPLAYS the read
  // projection (under Both that's the verbatim leader side of its writes).
  const lens: EditRoleView = editable ? view : asReadView(view);
  const displayView = asReadView(lens);

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

  const gridDance = dance ?? "waltz";
  const beatsPerBar = DANCES[gridDance].beatsPerBar;
  // The figure's authored length in COUNTS (Builder v3 ①): the explicit `counts`
  // prop, else a legacy `bars × beatsPerBar`, else the step default — but an
  // entirely EMPTY un-authored figure opens with a full bar's worth of slots so
  // there's somewhere to notate. Clamped ≥1.
  const liveAttrs = useMemo(() => attrs.filter((a) => a.deletedAt == null), [attrs]);
  const resolvedCounts =
    counts == null && legacyBars == null && liveAttrs.length === 0
      ? beatsPerBar
      : resolveFigureCounts({
          ...(counts != null ? { counts } : {}),
          ...(legacyBars != null ? { bars: legacyBars } : {}),
          attributes: liveAttrs,
          dance: gridDance,
        });

  // The grid columns: every kind applicable to the dance (all-applicable, so empty
  // cells are addable) — the EDIT counterpart to the reading view's used-columns.
  // biome-ignore lint/correctness/useExhaustiveDependencies(locale): allColumns reads the active locale via getLocale(), so its labels must recompute on switch.
  const columns = useMemo(() => allColumns(dance, customKinds), [dance, customKinds, locale]);
  const colorByKind = useMemo(() => {
    const map = new Map<string, string>();
    for (const k of customKinds) map.set(k.kind, k.color);
    return map;
  }, [customKinds]);

  // The grid rows: EVERY timing the bar count allows (bar → beat → e/&/a),
  // generated from `bars` (US-028) — plus any attribute placed OUTSIDE that range
  // (e.g. a step left beyond a since-shrunk bar count) so no value is ever hidden.
  const rows = useMemo(() => {
    const slots = figureCountSlots(resolvedCounts, gridDance);
    const inGrid = new Set(slots.map((s) => s.count));
    const extras: GridSlot[] = placedCounts
      .filter((c) => !inGrid.has(c))
      .map((c) => ({
        count: c,
        label: phraseCountLabel(c, gridDance),
        bar: Math.max(1, Math.ceil(Math.floor(c) / beatsPerBar)),
        beat: Math.floor(c),
        whole: Number.isInteger(c),
      }));
    // Portion window (Builder v3 ③, §4.4): a placement that dances only counts
    // [fromCount, toCount] edits only those rows — the figure doc stays whole, so
    // the underlying `attrs` (and thus onChange's merge-back) is untouched; we
    // just don't render the beats outside the window.
    return windowAttributes(
      [...slots, ...extras].sort((a, b) => a.count - b.count),
      part,
    );
  }, [resolvedCounts, gridDance, beatsPerBar, placedCounts, part]);

  /** Replace one count's attributes within the full set + emit (COW on first
   *  edit of a non-owned global figure). */
  const onCountChange = (count: number, next: Attribute[]): void => {
    const others = attrs.filter((a) => a.count !== count || a.deletedAt != null);
    if (isGlobal && !copied) setCopied(true);
    onChange?.([...others, ...next]);
  };

  // Quick-add (Builder v3 ②): tapping an EMPTY cell of an OPEN kind (the merged
  // Step column, a free-text kind, or one with no closed value list) instantly
  // places a PRESENCE attribute (`value: null` — the dashed ring) instead of
  // opening the editor; tap it again to set its value. A closed-enum kind still
  // opens the single-attribute editor directly — there's a value to pick.
  // biome-ignore lint/correctness/useExhaustiveDependencies(locale): localizedRegistry reads the active locale via getLocale(), so it must recompute on switch.
  const registry = useMemo(
    () => mergeRegistry(localizedRegistry(getLocale()), customKinds),
    [customKinds, locale],
  );
  const quickAddKind = (col: ReadingColumn): string | null => {
    if (col.isStep) return "direction"; // a blank STEP = a presence direction attr
    const kind = registry[col.kind];
    if (!kind || kind.valueType === "text" || kind.freeText || !kind.values?.length) {
      return col.kind;
    }
    return null;
  };
  const onCellTap = (count: number, col: ReadingColumn): void => {
    const here = (byCount.get(count) ?? []).filter((a) => columnKinds(col).includes(a.kind));
    if (here.length === 0) {
      const kind = quickAddKind(col);
      if (kind) {
        // WEP-0005: the quick-added presence inherits the lens as its WRITE
        // SCOPE — under a single role it must not leak into the partner's
        // chart; a presence has no value to mirror, so Both stays shared.
        onCountChange(count, [
          ...(byCount.get(count) ?? []),
          {
            id: `${kind}-${count}-presence-${Date.now()}`,
            kind,
            count,
            value: null,
            role: lens === "both" ? null : lens,
            deletedAt: null,
          },
        ]);
        toast.show(col.isStep ? t.stepPlacedToast : t.presenceAddedToast);
        return;
      }
    }
    setOpenCell({ count, column: col });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header controls: the "− N bars +" length stepper (editor only) + the
          "Steps for" role lens (frame 1.11). The lens is a per-device VIEW. */}
      <div className="flex flex-wrap items-center gap-3">
        {/* A portioned placement (Builder v3 ③) hides the LENGTH stepper: the
            window is FIXED, and figure length is the whole figure's concern —
            instead we label the placed slice ("4–6 of 6"). */}
        {editable && onCountsChange && !part && (
          <Stepper
            label={t.countsStepperLabel}
            hideLabel
            unit={t.countsStepperUnit}
            min={1}
            max={64}
            value={resolvedCounts}
            onChange={(next) => onCountsChange(next)}
          />
        )}
        {part && (
          <span
            className="text-2xs font-bold uppercase tracking-wider text-ink-muted"
            data-portion-label
          >
            {t.partLabel(
              Math.max(1, Math.ceil(part.fromCount)),
              Math.floor(part.toCount),
              resolvedCounts,
            )}
          </span>
        )}
        <div className="flex items-center gap-2">
          <span className="text-2xs font-bold uppercase tracking-wider text-ink-muted">
            {t.stepsFor}
          </span>
          {/* WEP-0005: editing offers the third "Both" lens (the write scope);
              reading keeps the two-way Leader/Follower lens. */}
          <SegmentedToggle<EditRoleView>
            ariaLabel={t.stepsFor}
            value={lens}
            onChange={setView}
            options={[
              { value: "leader", label: t.leader },
              { value: "follower", label: t.follower },
              ...(editable ? [{ value: "both" as const, label: t.both }] : []),
            ]}
          />
          {lens === "both" && <span className="text-2xs italic text-ink-faint">{t.bothHint}</span>}
        </div>
        {/* "Add to my library" ↔ "in your library" (⟳v5, §4.2/§5.2): an OWNED
            (account) figure only — a global figure's bookmark affordance lives on
            the Library screen's "↟ save" card, not here. */}
        {!isGlobal &&
          (isBookmarked ? (
            <span
              className="rounded-pill px-2 py-0.5 text-2xs font-semibold"
              style={{
                background: "var(--bf-scope-global-tint)",
                color: "var(--bf-scope-global-ink)",
              }}
            >
              {t.inYourLibrary}
            </span>
          ) : (
            onAddToLibrary &&
            (libraryName != null ? (
              /* Naming bar (Builder v3 ⑤): name the variant as it enters the
                   library — the name renames the LIVE shared figure doc. */
              <span className="flex items-center gap-2">
                <input
                  aria-label={t.variantNameLabel}
                  placeholder={t.variantNamePlaceholder}
                  value={libraryName}
                  onChange={(e) => setLibraryName(e.target.value)}
                  className="min-h-[36px] rounded-[8px] border-[1.5px] px-2 text-2xs font-semibold text-ink"
                  style={{ borderColor: "var(--bf-border-strong)" }}
                />
                <Button variant="ghost" size="sm" onClick={() => setLibraryName(null)}>
                  {t.variantNameCancel}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    const next = libraryName.trim();
                    if (next && next !== figureName) onRenameFigure?.(next);
                    onAddToLibrary();
                    setLibraryName(null);
                  }}
                >
                  {t.variantNameSave}
                </Button>
              </span>
            ) : (
              <>
                {/* Identity reassurance (Builder v3 variant bar): the figure was
                      adjusted for this choreo but is still the same named figure.
                      Variants/diverged-origin figures only (`adjusted`) — a
                      from-scratch custom was never adjusted from anything. */}
                {adjusted && figureName && (
                  <span className="rounded-[8px] bg-surface-sunken px-2 py-1.5 text-2xs font-semibold text-ink-muted">
                    {t.adjustedStill(figureName)}
                  </span>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setLibraryName(figureName ?? "")}
                >
                  <span aria-hidden="true">↟</span> {t.addToMyLibrary}
                </Button>
              </>
            ))
          ))}
      </div>

      {isGlobal && (
        <div className="flex flex-col gap-1">
          {(copied || forked) && (
            <p role="status" className="text-2xs text-accent">
              {forked ? t.variantOf(baseName) : t.madeYours}
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
              {t.forkIntoVariant}
            </Button>
          )}
        </div>
      )}

      {/* The column grid: sticky count column + one column per applicable kind,
          grouped into bars (a "bar N" divider precedes each bar's beats). */}
      <div className="overflow-x-auto">
        <table className="w-max border-separate border-spacing-y-1" aria-label={t.stepGrid}>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-surface">
                <span className="bf-sr-only">{t.countHeader}</span>
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
                    aria-label={t.aboutColumn(col.label)}
                    onClick={() => setInfoCol(col)}
                    className="cursor-pointer"
                    style={{ color: "inherit" }}
                  >
                    {col.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const newBar = i === 0 || rows[i - 1]?.bar !== row.bar;
              const allHere = byCount.get(row.count) ?? [];
              const here = filterByRoleView(allHere, displayView);
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
                    {columns.map((col) => {
                      // WEP-0005: under Both, a hand-diverged (kind, count) is
                      // LOCKED — Both may only edit derivation-consistent state.
                      const locked =
                        editable &&
                        lens === "both" &&
                        columnKinds(col).some((k) => {
                          const kd = registry[k];
                          return kd != null && !isBothConsistent(kd, allHere);
                        });
                      return (
                        <td key={col.id} className="px-0.5 align-middle">
                          <GridCell
                            column={col}
                            count={row.count}
                            label={cellValue(here, col)}
                            present={columnKinds(col).some((k) => here.some((a) => a.kind === k))}
                            offBeat={!row.whole}
                            editable={editable}
                            locked={locked}
                            color={colorByKind.get(col.kind)}
                            onOpen={() =>
                              locked ? toast.show(t.divergedLockedToast) : onCellTap(row.count, col)
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                </BarRowGroup>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Helper caption (frame 1.11). */}
      <p className="text-2xs italic text-ink-faint">{t.helperCaption}</p>

      {/* Per-count recap (the headline word + this count's value words) — the
          readable summary the authoring journey reads, present as soon as the
          figure opens. Rendered only when the caller wants the authoring aid
          (`showStepRecap`); the reading lens hides it. */}
      {showStepRecap &&
        rows.map((row) => {
          const here = filterByRoleView(byCount.get(row.count) ?? [], displayView);
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
                aria-label={t.countAttributes(row.count)}
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
          title={timingTitle(openCell.count, gridDance)}
          meta={openCell.column.label}
        >
          <AttributeEditor
            key={`${openCell.count}-${openCell.column.id}`}
            count={openCell.count}
            role={role}
            dance={dance}
            view={lens}
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
  const t = useMessages(timelineMessages);
  return (
    <>
      {showDivider && (
        <tr>
          <td
            colSpan={span + 1}
            className="pt-2 pb-0.5 text-2xs font-bold uppercase tracking-wider text-ink-faint"
          >
            {t.barN(bar)}
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

/** One grid cell — three states (Builder v3): a filled AttrChip (Step = merged
 *  direction·footwork) for a set value; a dashed "present" ring when the
 *  attribute exists but carries no value yet; a faint ＋ for an empty slot.
 *  Tapping a filled/present cell edits; tapping a ＋ adds. */
function GridCell({
  column,
  count,
  label,
  present,
  offBeat,
  editable,
  locked = false,
  color,
  onOpen,
}: {
  column: ReadingColumn;
  count: number;
  label: string | null;
  /** The attribute exists at this (count, kind) — even if it has no value. */
  present: boolean;
  offBeat: boolean;
  editable: boolean;
  /** WEP-0005: diverged under the Both lens — shown but not editable there. */
  locked?: boolean;
  color?: string;
  onOpen: () => void;
}) {
  const t = useMessages(timelineMessages);
  const cellLabel = locked
    ? t.lockedCell(column.label, countLabel(count))
    : present
      ? t.editCell(column.label, countLabel(count))
      : t.addCell(column.label, countLabel(count));
  const ringColor = color ?? columnColor(column);
  const content = label ? (
    <AttrChip kind={column.kind} label={label} color={color} dimmed={offBeat} />
  ) : present ? (
    <span
      aria-hidden="true"
      data-present-cell
      className="inline-flex h-[15px] w-[15px] items-center justify-center rounded-full border-[1.5px] border-dashed text-[10px] font-bold leading-none"
      style={{ borderColor: ringColor, color: ringColor }}
    >
      +
    </span>
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
    // Read grid: values (and present markers) only, no add affordances.
    return label || present ? (
      <span className={base} style={fillStyle}>
        {content}
      </span>
    ) : (
      <span className={base} style={fillStyle} aria-hidden="true" />
    );
  }
  return (
    <button
      type="button"
      aria-label={cellLabel}
      aria-disabled={locked || undefined}
      onClick={onOpen}
      className={cx(base, locked ? "cursor-not-allowed opacity-70" : "cursor-pointer")}
      style={fillStyle}
    >
      {content}
      {locked && (
        <span aria-hidden="true" className="ml-0.5 text-[10px] leading-none">
          🔒
        </span>
      )}
    </button>
  );
}
