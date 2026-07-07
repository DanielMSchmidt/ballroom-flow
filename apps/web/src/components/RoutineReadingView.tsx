// Reading lens (Builder v3 — Assemble · READING). A clean, read-only
// "programme" of the whole routine: a COLUMN-PICKER chips row (tap a chip to
// pick up to 4 technique columns, laid side-by-side across EVERY figure —
// picking a 5th drops the oldest, the last pick can't be removed; remembered
// per device, across choreos), a hand-written hint line, then per section a
// SectionDivider, then per figure a two-line header (name + beat-token timing
// sub) over a count × picked-columns table. The right 29% of every figure is
// the NOTES MARGIN: each step row (and the figure header) carries a margin
// cell with the note authors' avatars, a ＋ add affordance (commenter+), and
// the latest note as a two-line Caveat snippet — tapping the cell opens that
// anchor's thread. Off-beat (sub-beat) rows render dimmed.
//
// Pure presentation over the same store reads (no editing, no I/O). A null
// figure is rendered honestly per its load status (skeleton / unavailable),
// never silently dropped (#94).
import {
  type Annotation,
  type Attribute,
  DANCES,
  type DanceId,
  type FigureDoc,
  figureMatchesLibraryOrigin,
  type NumberedBeatEntry,
  numberRoutineBeats,
  type PlacementPart,
  type RegistryKind,
  type RoutineBeatEntry,
  type RoutineDoc,
  resolveFigureBars,
  resolveFigureCounts,
  slowQuickTokens,
  windowAttributes,
} from "@weavesteps/domain";
import { memo, useMemo, useRef, useState } from "react";
import { useMessages } from "../i18n";
import { timelineMessages } from "../i18n/messages/timeline";
import type { FigureLoadStatus, ResolvedPlacement } from "../store/routine";
import { AttrChip, cx, IDENTITY_COLORS, kindVar, SectionDivider, Skeleton } from "../ui";
import type { FigureScope } from "../ui/tokens";
import { AttributeInfoSheet } from "./AttributeInfoSheet";
import {
  cellPresent,
  cellValue,
  columnUsage,
  infoKindsForColumn,
  isColumnKind,
  isOffBeatCount,
  type ReadingColumn,
  usedColumns,
} from "./reading-columns";
// (windowAttributes/resolveFigureCounts arrive via the domain import above)
import { shownReadColumns, useStoredReadColumns } from "./reading-shown";
import type { TimingView } from "./reading-timing";
import { filterByRoleView, type RoleView } from "./role-view";

/** The notes margin's share of the row (Builder v3: `flex:0 0 29%`). */
const MARGIN_BASIS = "29%";

export function RoutineReadingView({
  routine,
  placements,
  annotations = [],
  canComment = false,
  memberColors,
  memberNames,
  customKinds = [],
  roleView,
  timingView = "counts",
  onOpenFigure,
  onOpenThread,
}: {
  routine: RoutineDoc;
  placements: ResolvedPlacement[];
  /** Annotations on this routine — surfaced in the notes margin beside their step. */
  annotations?: Annotation[];
  /** Whether THIS member may add a comment (commenter/editor — NOT a viewer).
   *  Gates the margin's ＋ add affordance (a viewer reads notes only). */
  canComment?: boolean;
  /** Real `authorId → stored hex` map built from `useMembers` + `useMe` by the
   *  caller (Assemble). When an authorId is found here, the margin avatar uses
   *  the stored colour directly. Unknown authors fall back to the hash. */
  memberColors?: Record<string, string>;
  /** `authorId → display name` map (same source) — drives the initial inside
   *  the margin avatar (colour is never the only signal — #5). */
  memberNames?: Record<string, string>;
  /** User-defined kinds merged into the registry (US-043) — so the attribute info
   *  overlay (frame 1.13) can describe a custom kind's prose/values too. */
  customKinds?: RegistryKind[];
  /** The active Leader/Follower lens (controlled — persisted by the caller,
   *  who renders the compact L·F toggle in the screen header). */
  roleView: RoleView;
  /** How step timings read: numeric counts (default) or slow/quick syllables
   *  (Tango/Foxtrot/Quickstep). Controlled + persisted by the caller. */
  timingView?: TimingView;
  /** Tap a figure name → Figure detail (existing open-figure flow). */
  onOpenFigure?: (figureId: string) => void;
  /** Tap a margin cell → open the annotation thread for that anchor (QUAL-2:
   *  passes the specific figureRef + count so the caller can focus the panel
   *  on the right anchor). A whole-figure cell omits `count` (US-004a). */
  onOpenThread?: (anchor: { figureRef: string; count?: number }) => void;
}) {
  const t = useMessages(timelineMessages);
  const dance = routine.dance;
  const resolvedByPlacement = useMemo(
    () => new Map(placements.map((p) => [p.placement.id, p])),
    [placements],
  );
  // Continuous beat numbering (US-004a): one running counter threads the whole
  // routine in placement order, wrapping at the dance's phrase length. Breaks
  // advance it too. We compute it ONCE here and hand each placement its result;
  // the edit view keeps per-figure LOCAL counts (this is display-only).
  // MEMOIZED on the STRUCTURAL inputs (sections + resolved placements — both
  // identity-stable across annotation-only changes thanks to the store's
  // reconcile), so an added note re-uses every beat-token array and the
  // memoized FigureReadouts below can bail out.
  const numberByPlacement = useMemo(
    () =>
      numberRoutineBeats_forRoutine(
        routine.sections,
        resolvedByPlacement,
        roleView,
        dance,
        timingView,
      ),
    [routine.sections, resolvedByPlacement, roleView, dance, timingView],
  );
  // Per-figure annotation slices with STABLE identities: only the slice of the
  // figure whose notes changed gets a new array — every other FigureReadout
  // sees reference-equal props and skips its re-render (React.memo below).
  const annotationsByFigure = useStableAnnotationsByFigure(annotations);
  // The column picker (Builder v3): the reader's picked column ids, per device
  // + across choreos. The chips row covers every type USED anywhere in this
  // routine (under the active role lens — same "only what's set" rule as the
  // tables); every figure renders exactly the picked columns.
  const [pickedColumns, togglePickedColumn] = useStoredReadColumns();
  const routineColumns = useMemo(() => {
    const all: Attribute[] = [];
    for (const rp of placements) {
      if (!rp.figure) continue;
      all.push(
        ...filterByRoleView(
          rp.figure.attributes.filter((a) => a.deletedAt == null),
          roleView,
        ),
      );
    }
    return usedColumns(all, dance);
  }, [placements, roleView, dance]);
  const shownColumns = useMemo(
    () => shownReadColumns(pickedColumns, routineColumns),
    [pickedColumns, routineColumns],
  );
  const onChipTap = (col: ReadingColumn) => {
    // The last shown column can't be removed (min 1 — Builder v3).
    if (shownColumns.length === 1 && shownColumns[0]?.id === col.id) return;
    togglePickedColumn(col.id);
  };
  return (
    <div data-testid="reading-view" className="flex flex-col gap-[10px]">
      {/* Column picker (Builder v3): one chip per used type — tap to pick up
          to 4 columns, laid side-by-side across EVERY figure. The
          Leader/Follower lens lives in the screen header (Assemble). */}
      {routineColumns.length > 0 && (
        <>
          <fieldset
            data-tour="type-chips"
            aria-label={t.shownColumns}
            className="flex flex-wrap items-center gap-[5px]"
          >
            {routineColumns.map((col) => (
              <FilterChip
                key={col.id}
                column={col}
                on={shownColumns.some((c) => c.id === col.id)}
                customKinds={customKinds}
                onTap={onChipTap}
              />
            ))}
          </fieldset>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] bg-accent-tint"
            >
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--bf-accent)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 11.5a8.38 8.38 0 0 1-8.9 8.4 8.5 8.5 0 0 1-3.8-.9L3 20l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.4-8.9 8.5 8.5 0 0 1 8.6 8.4z" />
              </svg>
            </span>
            <span
              className="flex-1 text-[14px] text-ink-faint"
              style={{ fontFamily: "var(--bf-font-note)" }}
            >
              {t.readingHint}
            </span>
          </div>
        </>
      )}

      {routine.sections.length === 0 ? (
        <p className="text-2xs text-ink-faint">{t.noSections}</p>
      ) : (
        routine.sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-[12px]">
            <SectionDivider label={section.name} />
            {section.placements.length === 0 ? (
              <p className="text-2xs text-ink-faint">{t.noFiguresInSection}</p>
            ) : (
              section.placements.map((pl) => {
                const numbered = numberByPlacement.get(pl.id);
                if (pl.source === "break") {
                  return (
                    <BreakReadout
                      key={pl.id}
                      numbered={numbered?.kind === "break" ? numbered : undefined}
                    />
                  );
                }
                const rp = resolvedByPlacement.get(pl.id);
                const figureId = rp?.figure?.id;
                return (
                  <FigureReadout
                    key={pl.id}
                    figure={rp?.figure ?? null}
                    status={rp?.status ?? "loading"}
                    part={pl.part ?? null}
                    roleView={roleView}
                    columns={shownColumns}
                    beatTokens={numbered?.kind === "figure" ? numbered.tokens : NO_TOKENS}
                    annotations={(figureId && annotationsByFigure.get(figureId)) || NO_ANNOTATIONS}
                    canComment={canComment}
                    memberColors={memberColors}
                    memberNames={memberNames}
                    customKinds={customKinds}
                    scopeLabel={routine.title}
                    onOpenFigure={onOpenFigure}
                    onOpenThread={onOpenThread}
                  />
                );
              })
            )}
          </section>
        ))
      )}
    </div>
  );
}

// Stable empties: a figure with no notes / no beats must receive the SAME
// array identity every render, or React.memo could never bail for it.
const NO_ANNOTATIONS: Annotation[] = [];
const NO_TOKENS: string[] = [];

/**
 * Group annotations by the figure they anchor to (point OR whole-figure
 * anchors), keeping each group's ARRAY IDENTITY stable across regroupings when
 * its members are unchanged. Annotation objects themselves are identity-stable
 * across snapshots (store reconcile), so "unchanged" is a cheap reference scan.
 * The result: adding a note to figure X hands ONLY X's FigureReadout a new
 * `annotations` prop.
 */
function useStableAnnotationsByFigure(annotations: Annotation[]): Map<string, Annotation[]> {
  const prevRef = useRef<Map<string, Annotation[]>>(new Map());
  return useMemo(() => {
    const next = new Map<string, Annotation[]>();
    for (const a of annotations) {
      if (a.deletedAt != null) continue;
      const seen = new Set<string>();
      for (const an of a.anchors) {
        if ((an.type === "point" || an.type === "figure") && !seen.has(an.figureRef)) {
          seen.add(an.figureRef);
          const arr = next.get(an.figureRef);
          if (arr) arr.push(a);
          else next.set(an.figureRef, [a]);
        }
      }
    }
    for (const [figureRef, arr] of next) {
      const prev = prevRef.current.get(figureRef);
      if (prev && prev.length === arr.length && prev.every((x, i) => x === arr[i])) {
        next.set(figureRef, prev);
      }
    }
    prevRef.current = next;
    return next;
  }, [annotations]);
}

/** A figure's distinct, sorted counts under the active role lens — the same
 *  derivation FigureReadout renders from, so numbering aligns with the rows. */
function figureCounts(
  figure: FigureDoc,
  roleView: RoleView,
  part?: PlacementPart | null,
): number[] {
  const live = windowAttributes(
    filterByRoleView(
      figure.attributes.filter((a) => a.deletedAt == null),
      roleView,
    ),
    part,
  );
  return [...new Set(live.map((a) => a.count))].sort((a, b) => a - b);
}

/** Number the whole routine's beats once (US-004a), returning a placement-id →
 *  numbered-entry map. Threads a single counter across every section/placement in
 *  order; a null (loading/missing) figure contributes no beats (best effort). */
function numberRoutineBeats_forRoutine(
  sections: RoutineDoc["sections"],
  resolved: Map<string, ResolvedPlacement>,
  roleView: RoleView,
  dance: DanceId,
  timingView: TimingView = "counts",
): Map<string, NumberedBeatEntry | undefined> {
  const beatsPerBar = DANCES[dance].beatsPerBar;
  const ids: string[] = [];
  const entries: RoutineBeatEntry[] = [];
  // For the slow/quick lens, each figure's tokens come from its OWN step
  // durations (bounded by its authored length), not the continuous counter —
  // so we remember each figure entry's end count (bars × beatsPerBar + 1).
  const figureEndByIndex = new Map<number, number>();
  for (const section of sections) {
    for (const pl of section.placements) {
      const index = ids.length;
      ids.push(pl.id);
      if (pl.source === "break") {
        entries.push({ kind: "break", beats: pl.beats ?? beatsPerBar });
      } else {
        const fig = resolved.get(pl.id)?.figure ?? null;
        entries.push({ kind: "figure", counts: fig ? figureCounts(fig, roleView, pl.part) : [] });
        if (fig) figureEndByIndex.set(index, resolveFigureBars(fig) * beatsPerBar + 1);
      }
    }
  }
  const numbered = numberRoutineBeats(entries, dance);
  if (timingView === "slowquick") {
    // Replace each figure's numeric tokens with slow/quick syllables. Breaks
    // keep their continuous beat span (a break has no rhythm to notate).
    for (let i = 0; i < numbered.length; i++) {
      const entry = numbered[i];
      const source = entries[i];
      if (entry?.kind === "figure" && source?.kind === "figure") {
        entry.tokens = slowQuickTokens(
          source.counts,
          figureEndByIndex.get(i) ?? source.counts.length + 1,
        );
      }
    }
  }
  return new Map(ids.map((id, i) => [id, numbered[i]]));
}

/** A break/wait row in the reading view (US-004a): a muted row showing the beat
 *  span it occupies (e.g. "beats 4–6") + its bar count. Advances the counter. */
function BreakReadout({ numbered }: { numbered?: Extract<NumberedBeatEntry, { kind: "break" }> }) {
  const t = useMessages(timelineMessages);
  const span = numbered?.span ?? "break";
  const bars = numbered?.bars ?? 1;
  return (
    <div
      data-testid="break-readout"
      className="flex items-center gap-[7px] rounded-[7px] px-[8px] py-[6px]"
      style={{ background: "var(--bf-surface-sunken)" }}
    >
      <span aria-hidden="true" className="text-2xs font-bold text-ink-faint">
        ❚❚
      </span>
      <span className="text-2xs font-bold uppercase tracking-wider text-ink-muted">
        {t.breakLabel}
      </span>
      <span className="text-2xs text-ink-muted">{span}</span>
      <span className="text-2xs font-medium text-ink-faint">· {t.bars(bars)}</span>
    </div>
  );
}

/** The figure's badge scope, derived by content DIVERGENCE (not the copy
 *  mechanism): a frozen account copy carries its own attributes and `baseFigureRef`
 *  is provenance only — an account figure still matching its catalog origin reads
 *  Library, otherwise Custom (§2.5.1 #19–20). */
function figureScope(figure: FigureDoc): FigureScope {
  if (figure.scope === "global") return "library";
  return figureMatchesLibraryOrigin(figure) ? "library" : "custom";
}

/** The column's flex weight (Builder v3: the merged Step column gets 1.7×). */
function columnWeight(col: ReadingColumn): number {
  return col.isStep ? 1.7 : 1;
}

/** One figure's notation, read-only: a two-line header + a count × picked-
 *  columns table, with the notes margin owning the right 29% of every row.
 *  MEMOIZED: with the store's reconcile keeping figure/annotation identities
 *  stable, a note added elsewhere (or any unrelated doc change) leaves every
 *  prop reference-equal and this whole subtree skips its re-render — only the
 *  figure whose notes/content changed re-renders. */
const FigureReadout = memo(function FigureReadout({
  figure,
  status,
  part,
  roleView,
  columns,
  beatTokens,
  annotations,
  canComment,
  memberColors,
  memberNames,
  customKinds = [],
  scopeLabel,
  onOpenFigure,
  onOpenThread,
}: {
  figure: FigureDoc | null;
  status: FigureLoadStatus;
  /** Portion window (Builder v3 ③) — dance only these counts of the figure. */
  part?: PlacementPart | null;
  roleView: RoleView;
  /** The routine-wide PICKED columns (Builder v3) — every figure renders
   *  exactly these; a figure without the kind shows empty dots. */
  columns: ReadingColumn[];
  /** The continuous beat token per distinct sorted count (US-004a), aligned to
   *  this figure's `counts`. Drives the timing sub + per-step count cell. */
  beatTokens: string[];
  annotations: Annotation[];
  canComment: boolean;
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
  customKinds?: RegistryKind[];
  scopeLabel?: string;
  onOpenFigure?: (figureId: string) => void;
  onOpenThread?: (anchor: { figureRef: string; count?: number }) => void;
}) {
  // The attribute kind whose info overlay is open (frame 1.13), or null. Tapping
  // a value chip or a column header opens the plain-language reference. State is
  // per-figure so usage counts + columns are scoped to the figure that was tapped.
  const [infoCol, setInfoCol] = useState<ReadingColumn | null>(null);
  const t = useMessages(timelineMessages);
  if (!figure) {
    // A loading figure shows a skeleton (never silently vanishes); a genuinely
    // unavailable one says so plainly. A transient error reads as unavailable
    // too — this is the read-only view, so there's no retry affordance here.
    if (status === "missing" || status === "error") {
      return (
        <p className="text-2xs text-ink-faint" role="status">
          {t.figureUnavailable}
        </p>
      );
    }
    return (
      <div aria-busy="true">
        <Skeleton className="w-32" />
        <span className="sr-only" role="status">
          {t.loadingFigure}
        </span>
      </div>
    );
  }
  // The Leader/Follower lens: both-role attributes always show; role-specific
  // ones show only on their side (US: Follower flips role-aware values).
  const live = windowAttributes(
    filterByRoleView(
      figure.attributes.filter((a) => a.deletedAt == null),
      roleView,
    ),
    part,
  );
  const counts = [...new Set(live.map((a) => a.count))].sort((a, b) => a - b);
  // The continuous beat token per count (US-004a), zipped with the sorted counts.
  const tokenByCount = new Map(counts.map((c, i) => [c, beatTokens[i] ?? String(c)]));
  // Notes anchored to a specific step (point) of this figure — margin cells.
  const figureComments = annotations.filter(
    (a) =>
      a.deletedAt == null &&
      a.anchors.some((an) => an.type === "point" && an.figureRef === figure.id),
  );
  // Notes anchored to the WHOLE figure (figure anchor, no count — US-004a).
  const wholeFigureComments = annotations.filter(
    (a) =>
      a.deletedAt == null &&
      a.anchors.some((an) => an.type === "figure" && an.figureRef === figure.id),
  );
  return (
    <div className="relative flex flex-col gap-[5px]">
      {/* The vertical rule between the notation and the notes margin. */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 top-[2px] w-[1.5px]"
        style={{ right: MARGIN_BASIS, background: "var(--bf-border-subtle)" }}
      />
      {/* Figure header row: scope dot + two-line name / timing sub, then the
          whole-figure notes margin cell. */}
      <div className="flex items-stretch">
        <div className="flex min-w-0 flex-1 items-center gap-2 pr-[10px]">
          <ScopeDot scope={figureScope(figure)} />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="block max-w-full truncate text-left text-[14px] font-bold text-ink hover:underline"
              onClick={() => onOpenFigure?.(figure.id)}
            >
              {figure.name}
            </button>
            <div className="truncate text-2xs font-semibold text-ink-faint">
              {counts.length > 0 ? beatTokens.join(" ") : t.emptyFigureSub}
              {part &&
                ` · ${t.partLabel(part.fromCount, part.toCount, resolveFigureCounts(figure))}`}
            </div>
          </div>
        </div>
        <NotesMarginCell
          label={t.notesForFigure(figure.name)}
          comments={wholeFigureComments}
          canComment={canComment}
          memberColors={memberColors}
          memberNames={memberNames}
          onOpen={onOpenThread && (() => onOpenThread({ figureRef: figure.id }))}
        />
      </div>

      {counts.length > 0 && (
        <>
          {/* Column header row + the NOTES margin label. */}
          <div className="flex items-stretch">
            <div className="flex min-h-[36px] min-w-0 flex-1 items-center gap-1 pr-[10px]">
              <span className="w-[18px] flex-none" aria-hidden="true" />
              {columns.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  aria-label={t.aboutColumn(col.label)}
                  onClick={() => setInfoCol(col)}
                  className="min-w-0 cursor-pointer py-[6px] text-center text-2xs font-bold leading-none tracking-wide"
                  style={{ flexGrow: columnWeight(col), flexBasis: 0, color: columnColor(col) }}
                >
                  {col.label}
                </button>
              ))}
            </div>
            <div
              className="flex flex-none items-center pl-[10px]"
              style={{ flexBasis: MARGIN_BASIS }}
            >
              <span className="text-[8px] font-bold tracking-[.06em] text-ink-faint">
                {t.notesHeader}
              </span>
            </div>
          </div>
          <ol className="flex flex-col gap-[5px]" aria-label={t.figureSteps(figure.name)}>
            {counts.map((count) => (
              <StepRow
                key={count}
                count={count}
                label={tokenByCount.get(count) ?? String(count)}
                columns={columns}
                here={live.filter((a) => a.count === count)}
                comments={figureComments.filter((a) =>
                  a.anchors.some((an) => an.type === "point" && an.count === count),
                )}
                figureId={figure.id}
                canComment={canComment}
                memberColors={memberColors}
                memberNames={memberNames}
                onOpenInfo={setInfoCol}
                onOpenThread={onOpenThread}
              />
            ))}
          </ol>
        </>
      )}

      {/* The attribute explainer (Builder v2 — a full page) — opened by tapping a
          value chip or a column header. The merged Step column describes
          direction + footwork. The footer pager walks the picked columns. */}
      {infoCol &&
        (() => {
          const [primary, ...rest] = infoKindsForColumn(infoCol, customKinds, live);
          if (!primary) return null;
          const idx = columns.findIndex((c) => c.id === infoCol.id);
          const prev = columns[(idx - 1 + columns.length) % columns.length];
          const next = columns[(idx + 1) % columns.length];
          const pager =
            columns.length > 1 && idx >= 0 && prev && next
              ? {
                  prevLabel: prev.label,
                  nextLabel: next.label,
                  positionLabel: t.pagerPosition(idx + 1, columns.length),
                  onPrev: () => setInfoCol(prev),
                  onNext: () => setInfoCol(next),
                }
              : undefined;
          return (
            <AttributeInfoSheet
              open
              kind={primary}
              extraKinds={rest}
              title={infoCol.isStep ? infoCol.label : undefined}
              usageCount={columnUsage(live, [primary, ...rest])}
              scopeLabel={scopeLabel}
              onClose={() => setInfoCol(null)}
              pager={pager}
            />
          );
        })()}
    </div>
  );
});

/** One column-picker chip (Builder v3): ON = the kind's tint/ink/border family
 *  (this column is laid out); OFF = dashed grey over the plain surface (grey
 *  stays "empty / off", never data). A custom kind passes its registry color
 *  through (border/ink + a leading dot, like AttrChip) so user-defined types
 *  sit in the row like builtins. */
function FilterChip({
  column,
  on,
  customKinds,
  onTap,
}: {
  column: ReadingColumn;
  on: boolean;
  customKinds: RegistryKind[];
  onTap: (col: ReadingColumn) => void;
}) {
  const t = useMessages(timelineMessages);
  const family = columnChipFamily(column, customKinds);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? t.hideColumn(column.label) : t.showColumn(column.label)}
      onClick={() => onTap(column)}
      className={cx(
        "inline-flex min-h-[36px] items-center gap-1 rounded-[6px] border-[1.5px] px-2 py-1 text-2xs leading-none",
        on ? "font-bold" : "border-dashed font-semibold",
      )}
      style={
        on
          ? { background: family.tint, color: family.ink, borderColor: family.border }
          : {
              background: "var(--bf-surface)",
              color: "var(--bf-ink-faint)",
              borderColor: "var(--bf-border-strong)",
            }
      }
    >
      {column.label}
      {family.dot && on && (
        <span
          aria-hidden="true"
          className="h-[6px] w-[6px] flex-none rounded-full"
          style={{ background: family.dot }}
        />
      )}
    </button>
  );
}

/** A chip's ON color family: standard kinds use their token family; a custom
 *  kind passes its stored color through as border/ink over a neutral tint,
 *  plus a leading dot (the AttrChip treatment — DESIGN-PRINCIPLES #24). */
function columnChipFamily(
  col: ReadingColumn,
  customKinds: RegistryKind[],
): { tint: string; ink: string; border: string; dot?: string } {
  if (isColumnKind(col.kind)) {
    return {
      tint: kindVar(col.kind, "tint"),
      ink: kindVar(col.kind, "ink"),
      border: kindVar(col.kind, "border"),
    };
  }
  const custom = customKinds.find((k) => k.kind === col.kind)?.color;
  return {
    tint: "var(--bf-surface-sunken)",
    ink: custom ?? "var(--bf-ink-secondary)",
    border: custom ?? "var(--bf-border-strong)",
    dot: custom,
  };
}

/** A column's header/text color — the kind's base token, slate for unknowns. */
function columnColor(col: ReadingColumn): string {
  return isColumnKind(col.kind) ? kindVar(col.kind) : "var(--bf-ink-secondary)";
}

/** One step row: the sunken notation strip (count cell + a chip-or-dot per
 *  picked column) then the step's notes margin cell. Off-beat (sub-beat) rows
 *  render dimmed. */
function StepRow({
  count,
  label,
  columns,
  here,
  comments,
  figureId,
  canComment,
  memberColors,
  memberNames,
  onOpenInfo,
  onOpenThread,
}: {
  count: number;
  /** The continuous beat token to display in the count cell (US-004a). */
  label: string;
  columns: ReadingColumn[];
  here: Attribute[];
  comments: Annotation[];
  figureId: string;
  canComment: boolean;
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
  /** Tapping a value chip opens that kind's attribute info overlay (frame 1.13). */
  onOpenInfo: (col: ReadingColumn) => void;
  onOpenThread?: (anchor: { figureRef: string; count?: number }) => void;
}) {
  const t = useMessages(timelineMessages);
  const offBeat = isOffBeatCount(count);
  return (
    <li className="flex items-stretch">
      <div className="flex min-w-0 flex-1 pr-[10px]">
        <div
          data-offbeat={offBeat ? "true" : undefined}
          className="flex min-h-[40px] flex-1 items-stretch gap-1 rounded-[8px] bg-surface-muted px-[5px] py-[5px]"
        >
          <span
            className={cx(
              "w-[18px] flex-none self-center text-center font-bold tabular-nums",
              offBeat ? "text-[10px] text-ink-faint" : "text-[12px] text-accent",
            )}
          >
            {label}
          </span>
          {columns.map((col) => {
            const value = cellValue(here, col);
            return (
              <span
                key={col.id}
                className="flex min-w-0 items-center justify-center"
                style={{ flexGrow: columnWeight(col), flexBasis: 0 }}
              >
                {value ? (
                  <button
                    type="button"
                    aria-label={t.aboutValue(col.label, value)}
                    onClick={() => onOpenInfo(col)}
                    className="max-w-full cursor-pointer"
                  >
                    <AttrChip kind={col.kind} label={value} />
                  </button>
                ) : cellPresent(here, col) ? (
                  <PresentSlot color={columnColor(col)} />
                ) : (
                  <EmptySlot />
                )}
              </span>
            );
          })}
        </div>
      </div>
      <NotesMarginCell
        label={t.notesForCount(label)}
        comments={comments}
        canComment={canComment}
        memberColors={memberColors}
        memberNames={memberNames}
        onOpen={onOpenThread && (() => onOpenThread({ figureRef: figureId, count }))}
      />
    </li>
  );
}

/** A notes-margin cell (Builder v3): the note authors' avatars (latest-first,
 *  up to 3 — initial inside the dot, colour never the only signal #5), a ＋
 *  add chip for a member who may comment, and the latest note as a two-line
 *  Caveat snippet. The whole cell is one tap target opening the anchor's
 *  thread (a viewer may read it; only a commenter may add). */
function NotesMarginCell({
  label,
  comments,
  canComment,
  memberColors,
  memberNames,
  onOpen,
}: {
  label: string;
  comments: Annotation[];
  canComment: boolean;
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
  onOpen?: () => void;
}) {
  const latest = comments.length > 0 ? comments[comments.length - 1] : undefined;
  // Distinct authors, latest first (Builder v3 `_margin`), capped at 3.
  const authors: string[] = [];
  for (let i = comments.length - 1; i >= 0 && authors.length < 3; i--) {
    const id = comments[i]?.authorId;
    if (id && !authors.includes(id)) authors.push(id);
  }
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onOpen}
      className="flex min-h-[40px] min-w-0 flex-none cursor-pointer flex-col justify-center gap-[3px] pl-[10px] text-left"
      style={{ flexBasis: MARGIN_BASIS }}
    >
      <span className="flex items-center gap-[3px]">
        {authors.map((id) => (
          <span
            key={id}
            data-avatar
            className="flex h-[16px] w-[16px] flex-none items-center justify-center rounded-full text-[8px] font-bold text-ink-inverse"
            style={{ background: memberColors?.[id] ?? identityColor(id) }}
          >
            {authorInitial(memberNames?.[id])}
          </span>
        ))}
        {canComment && (
          <span
            aria-hidden="true"
            className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-[1.5px] text-[12px] font-bold leading-none text-accent"
            style={{ borderColor: "var(--bf-accent-border)" }}
          >
            ＋
          </span>
        )}
      </span>
      {latest && (
        <span
          className="line-clamp-2 text-[12px] leading-[1.3] text-ink-secondary"
          style={{ fontFamily: "var(--bf-font-note)" }}
        >
          {latest.text}
        </span>
      )}
    </button>
  );
}

/** The author's display initial for the margin avatar — empty when unknown. */
function authorInitial(name: string | undefined): string {
  return name?.trim().charAt(0).toUpperCase() ?? "";
}

/** A stable identity color slot for an author (profile-colored avatar). */
function identityColor(authorId: string): string {
  let h = 0;
  for (let i = 0; i < authorId.length; i++) h = (h * 31 + authorId.charCodeAt(i)) >>> 0;
  return IDENTITY_COLORS[h % IDENTITY_COLORS.length] ?? "var(--bf-identity-1)";
}

/** The figure's scope dot — blue (library) / amber (custom). The visible scope
 *  word rides as sr-only text so the cue isn't color-only (#5). */
function ScopeDot({ scope }: { scope: FigureScope }) {
  const t = useMessages(timelineMessages);
  const color = scope === "library" ? kindVar("direction") : kindVar("footwork");
  return (
    <span className="inline-flex flex-none items-center">
      <span
        aria-hidden="true"
        className="h-[9px] w-[9px] rounded-full"
        style={{ background: color }}
      />
      <span className="bf-sr-only">{scope === "library" ? t.libraryFigure : t.customFigure}</span>
    </span>
  );
}

/** A notated-but-valueless step marker — a filled dot in the column's kind color
 *  (blue for the merged Step column). Distinguishes "a step is here, value not
 *  set yet" (Builder v3 ② presence) from a truly empty slot, so a step added
 *  without attributes still reads in the reading view. */
function PresentSlot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      data-present-cell
      className="h-[7px] w-[7px] rounded-full"
      style={{ background: color }}
    />
  );
}

/** An empty technique slot — a small ring dot (nothing logged here). */
function EmptySlot() {
  return (
    <span
      aria-hidden="true"
      className="h-[6px] w-[6px] rounded-full border-[1.5px]"
      style={{ borderColor: "var(--bf-border-strong)" }}
    />
  );
}
