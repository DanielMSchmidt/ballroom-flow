// Reading lens (design frame 1.6 — Assemble · READING). A clean, read-only
// "programme" of the whole routine: a TYPE-CHIPS filter row (design 1.23 —
// tap a chip to hide/show that technique column across every figure; Step*
// locked; remembered per device, across choreos), then per section a
// SectionDivider, then per figure a compact table whose columns are ONLY the
// attribute kinds that figure uses (the Step column merges direction +
// footwork into one blue chip) minus the hidden ones — a "+N hidden" pill
// peeks at what's tucked (collapses on the next scroll). The Leader/Follower
// role lens moved to the screen header as a compact L·F (Assemble). Off-beat
// (sub-beat) rows render dimmed. Inline comments surface the latest
// annotations on a step and open the thread.
//
// Pure presentation over the same store reads (no editing, no I/O). A null
// figure is rendered honestly per its load status (skeleton / unavailable),
// never silently dropped (#94).
import {
  type Annotation,
  type Attribute,
  barsForFigure,
  DANCES,
  type DanceId,
  type FigureDoc,
  figureMatchesLibraryOrigin,
  type NumberedBeatEntry,
  numberRoutineBeats,
  type RegistryKind,
  type RoutineBeatEntry,
  type RoutineDoc,
} from "@ballroom/domain";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "../i18n";
import { timelineMessages } from "../i18n/messages/timeline";
import type { FigureLoadStatus, ResolvedPlacement } from "../store/routine";
import {
  AttrChip,
  CountPill,
  cx,
  IDENTITY_COLORS,
  kindVar,
  SectionDivider,
  Skeleton,
  useToast,
} from "../ui";
import type { FigureScope } from "../ui/tokens";
import { AttributeInfoSheet } from "./AttributeInfoSheet";
import {
  cellValue,
  columnUsage,
  infoKindsForColumn,
  isOffBeatCount,
  type ReadingColumn,
  usedColumns,
} from "./reading-columns";
import {
  hasSeenHiddenHint,
  hiddenColumnCount,
  markHiddenHintSeen,
  useStoredHiddenColumns,
  visibleColumns,
} from "./reading-filter";
import { filterByRoleView, type RoleView } from "./role-view";

export function RoutineReadingView({
  routine,
  placements,
  annotations = [],
  canComment = false,
  memberColors,
  memberNames,
  customKinds = [],
  roleView,
  onOpenFigure,
  onOpenThread,
}: {
  routine: RoutineDoc;
  placements: ResolvedPlacement[];
  /** Annotations on this routine — surfaced as inline comments under their step. */
  annotations?: Annotation[];
  /** Whether THIS member may add a comment (commenter/editor — NOT a viewer).
   *  Gates the inline "+ add comment" affordance (a viewer reads comments only). */
  canComment?: boolean;
  /** Real `authorId → stored hex` map built from `useMembers` + `useMe` by the
   *  caller (Assemble). When an authorId is found here, the inline avatar uses
   *  the stored colour directly. Unknown authors fall back to the hash. */
  memberColors?: Record<string, string>;
  /** `authorId → display name` map (same source) — drives the initial inside
   *  the inline comment avatar (Builder v2: colour is paired with an initial,
   *  never colour alone — #5). Unknown authors show no initial. */
  memberNames?: Record<string, string>;
  /** User-defined kinds merged into the registry (US-043) — so the attribute info
   *  overlay (frame 1.13) can describe a custom kind's prose/values too. */
  customKinds?: RegistryKind[];
  /** The active Leader/Follower lens (controlled — persisted by the caller,
   *  who renders the compact L·F toggle in the screen header — design 1.23). */
  roleView: RoleView;
  /** Tap a figure name → Figure detail (existing open-figure flow). */
  onOpenFigure?: (figureId: string) => void;
  /** Tap a comment / "+ add comment" → open the annotation thread for that
   *  anchor (QUAL-2 fix: passes the specific figureRef + count, not just the
   *  figure id, so the caller can focus the panel on the right anchor). A
   *  whole-figure note omits `count` (US-004a). */
  onOpenThread?: (anchor: { figureRef: string; count?: number }) => void;
}) {
  const t = useMessages(timelineMessages);
  const dance = routine.dance as DanceId;
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
    () => numberRoutineBeats_forRoutine(routine.sections, resolvedByPlacement, roleView, dance),
    [routine.sections, resolvedByPlacement, roleView, dance],
  );
  // Per-figure annotation slices with STABLE identities: only the slice of the
  // figure whose notes changed gets a new array — every other FigureReadout
  // sees reference-equal props and skips its re-render (React.memo below).
  const annotationsByFigure = useStableAnnotationsByFigure(annotations);
  const toast = useToast();
  // The column filter (design 1.23): hidden column ids, per device + across
  // choreos. The chips row covers every type USED anywhere in this routine
  // (under the active role lens — same "only what's set" rule as the tables).
  const [hiddenColumns, toggleHiddenColumn] = useStoredHiddenColumns();
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
  // "+N hidden" peek (design 1.23 pin 2): ONE figure at a time expands to show
  // everything; chips stay put; collapses on the next scroll (a 450ms grace
  // absorbs the browser's own scroll on tap — same rule as the prototype).
  const [peekedPlacement, setPeekedPlacement] = useState<string | null>(null);
  const peekedAtRef = useRef(0);
  const onChipTap = useCallback(
    (col: ReadingColumn) => {
      if (col.isStep) {
        // Step* is required — never hideable (design 1.23).
        toast.show(t.columnAlwaysShownToast(col.label));
        return;
      }
      // The user plainly knows the filter now — never show the one-time hint.
      markHiddenHintSeen();
      setPeekedPlacement(null);
      toggleHiddenColumn(col.id);
    },
    [toast, toggleHiddenColumn, t],
  );
  const onTogglePeek = useCallback((placementId: string) => {
    peekedAtRef.current = Date.now();
    setPeekedPlacement((prev) => (prev === placementId ? null : placementId));
  }, []);
  useEffect(() => {
    if (peekedPlacement === null) return;
    const onScroll = () => {
      if (Date.now() - peekedAtRef.current > 450) setPeekedPlacement(null);
    };
    // Capture-phase so a scrolling ancestor container collapses the peek too.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, [peekedPlacement]);
  // Backup for tour skippers (design 1.26): the FIRST time a view hides data,
  // a one-time toast points at the "+N hidden" affordance.
  const hidesData = routineColumns.some((c) => !c.isStep && hiddenColumns.has(c.id));
  useEffect(() => {
    if (!hidesData || hasSeenHiddenHint()) return;
    markHiddenHintSeen();
    toast.show(t.hiddenColumnsHintToast);
  }, [hidesData, toast, t]);
  return (
    <div data-testid="reading-view" className="flex flex-col gap-[10px]">
      {/* Type chips (design 1.23 — ✓ chosen): one per used type, tap to hide /
          show that column across EVERY figure. Default: everything on. The
          Leader/Follower lens lives in the screen header (Assemble). */}
      {routineColumns.length > 0 && (
        <fieldset
          data-tour="type-chips"
          aria-label={t.shownColumns}
          className="flex flex-wrap items-center gap-[5px]"
        >
          {routineColumns.map((col) => (
            <FilterChip
              key={col.id}
              column={col}
              on={col.isStep === true || !hiddenColumns.has(col.id)}
              customKinds={customKinds}
              onTap={onChipTap}
            />
          ))}
        </fieldset>
      )}

      {routine.sections.length === 0 ? (
        <p className="text-2xs text-ink-faint">{t.noSections}</p>
      ) : (
        routine.sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-[9px]">
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
                    dance={dance}
                    roleView={roleView}
                    beatTokens={numbered?.kind === "figure" ? numbered.tokens : NO_TOKENS}
                    annotations={(figureId && annotationsByFigure.get(figureId)) || NO_ANNOTATIONS}
                    canComment={canComment}
                    memberColors={memberColors}
                    memberNames={memberNames}
                    customKinds={customKinds}
                    scopeLabel={routine.title}
                    hiddenColumns={hiddenColumns}
                    peekKey={pl.id}
                    peeked={peekedPlacement === pl.id}
                    onTogglePeek={onTogglePeek}
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
function figureCounts(figure: FigureDoc, roleView: RoleView): number[] {
  const live = filterByRoleView(
    figure.attributes.filter((a) => a.deletedAt == null),
    roleView,
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
): Map<string, NumberedBeatEntry | undefined> {
  const beatsPerBar = DANCES[dance].beatsPerBar;
  const ids: string[] = [];
  const entries: RoutineBeatEntry[] = [];
  for (const section of sections) {
    for (const pl of section.placements) {
      ids.push(pl.id);
      if (pl.source === "break") {
        entries.push({ kind: "break", beats: pl.beats ?? beatsPerBar });
      } else {
        const fig = resolved.get(pl.id)?.figure ?? null;
        entries.push({ kind: "figure", counts: fig ? figureCounts(fig, roleView) : [] });
      }
    }
  }
  const numbered = numberRoutineBeats(entries, dance);
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

/** One figure's notation, read-only: a compact count × used-columns table.
 *  MEMOIZED: with the store's reconcile keeping figure/annotation identities
 *  stable, a note added elsewhere (or any unrelated doc change) leaves every
 *  prop reference-equal and this whole subtree skips its re-render — only the
 *  figure whose notes/content changed re-renders. */
const FigureReadout = memo(function FigureReadout({
  figure,
  status,
  dance,
  roleView,
  beatTokens,
  annotations,
  canComment,
  memberColors,
  memberNames,
  customKinds = [],
  scopeLabel,
  hiddenColumns,
  peekKey,
  peeked,
  onTogglePeek,
  onOpenFigure,
  onOpenThread,
}: {
  figure: FigureDoc | null;
  status: FigureLoadStatus;
  dance: DanceId;
  roleView: RoleView;
  /** The continuous beat token per distinct sorted count (US-004a), aligned to
   *  this figure's `counts`. Drives the count pill + per-step count cell. */
  beatTokens: string[];
  annotations: Annotation[];
  canComment: boolean;
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
  customKinds?: RegistryKind[];
  scopeLabel?: string;
  /** The routine-wide hidden column ids (design 1.23 type chips). */
  hiddenColumns: ReadonlySet<string>;
  /** This readout's placement id — the peek key (stable across renders so the
   *  memo bails; the single `onTogglePeek` callback stays shared). */
  peekKey: string;
  /** While peeked this figure shows EVERY used column ("– hide" collapses). */
  peeked: boolean;
  onTogglePeek: (peekKey: string) => void;
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
  const live = filterByRoleView(
    figure.attributes.filter((a) => a.deletedAt == null),
    roleView,
  );
  const counts = [...new Set(live.map((a) => a.count))].sort((a, b) => a - b);
  // The figure's used columns, minus the routine-wide hidden ones (design
  // 1.23) — unless peeked, which shows everything. The "+N hidden" pill counts
  // the used-but-hidden columns; hiding never touches data (notes, breaks and
  // whole-figure comments are never filtered).
  const allUsedColumns = usedColumns(live, dance);
  const hiddenHere = hiddenColumnCount(allUsedColumns, hiddenColumns);
  const columns = visibleColumns(allUsedColumns, hiddenColumns, peeked);
  const bars = barsForFigure(counts, dance);
  // The continuous beat token per count (US-004a), zipped with the sorted counts.
  const tokenByCount = new Map(counts.map((c, i) => [c, beatTokens[i] ?? String(c)]));
  // Inline comments anchored to a specific step (point) of this figure.
  const figureComments = annotations.filter(
    (a) =>
      a.deletedAt == null &&
      a.anchors.some((an) => an.type === "point" && an.figureRef === figure.id),
  );
  // Comments anchored to the WHOLE figure (figure anchor, no count — US-004a).
  const wholeFigureComments = annotations.filter(
    (a) =>
      a.deletedAt == null &&
      a.anchors.some((an) => an.type === "figure" && an.figureRef === figure.id),
  );
  return (
    <div className="flex flex-col gap-[7px]">
      {/* Figure headline: scope dot + name + counts + (optional) bars. */}
      <div className="flex items-center gap-[7px]">
        <ScopeDot scope={figureScope(figure)} />
        <button
          type="button"
          className="text-[13px] font-bold text-ink hover:underline"
          onClick={() => onOpenFigure?.(figure.id)}
        >
          {figure.name}
        </button>
        {counts.length > 0 && <CountPill counts={beatTokens} />}
        {counts.length > 0 && (
          <span className="text-2xs font-medium text-ink-muted">{t.bars(bars)}</span>
        )}
      </div>

      {/* WHOLE FIGURE notes (US-004a): a note block under the header, distinct
          from per-step threads. Shown when there are notes OR the user may add
          the first one. Tapping opens the figure-level thread (no count). */}
      {(wholeFigureComments.length > 0 || canComment) && (
        <WholeFigureNotes
          comments={wholeFigureComments}
          figureId={figure.id}
          canComment={canComment}
          memberColors={memberColors}
          memberNames={memberNames}
          onOpenThread={onOpenThread}
        />
      )}

      {counts.length === 0 ? (
        <p className="text-2xs text-ink-faint">{t.noStepsYet}</p>
      ) : (
        <>
          <ColumnHeader
            columns={columns}
            onOpenInfo={setInfoCol}
            trailing={
              hiddenHere > 0 ? (
                <PeekPill count={hiddenHere} peeked={peeked} onTap={() => onTogglePeek(peekKey)} />
              ) : undefined
            }
          />
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
          direction + footwork. The footer pager walks this figure's columns. */}
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

/** The per-figure column header: a count gutter then each used kind in its
 *  kind color (frame 1.6: Step · Rise · Pos · Sway · Turn). Each kind label is a
 *  button that opens that kind's attribute info overlay (frame 1.13). The
 *  trailing slot carries the "+N hidden" peek pill (design 1.23). */
function ColumnHeader({
  columns,
  onOpenInfo,
  trailing,
}: {
  columns: ReadingColumn[];
  onOpenInfo: (col: ReadingColumn) => void;
  trailing?: ReactNode;
}) {
  const t = useMessages(timelineMessages);
  return (
    <div className="flex min-h-[40px] items-center gap-1 px-[2px]">
      <span className="w-[18px] flex-none" aria-hidden="true" />
      {columns.map((col) => (
        <button
          key={col.id}
          type="button"
          aria-label={t.aboutColumn(col.label)}
          onClick={() => onOpenInfo(col)}
          className="flex-1 cursor-pointer py-3 text-center text-2xs font-bold leading-none tracking-wide"
          style={{ color: columnColor(col) }}
        >
          {col.label}
        </button>
      ))}
      {trailing}
    </div>
  );
}

/** One type chip (design 1.23): ON = the kind's tint/ink/border family; OFF =
 *  dashed grey over the plain surface (grey stays "empty / off", never data).
 *  Step* is locked — tapping it only surfaces the "always shown" toast. A
 *  custom kind passes its registry color through (border/ink + a leading dot,
 *  like AttrChip) so user-defined types sit in the row like builtins. */
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
  const locked = column.isStep === true;
  const family = columnChipFamily(column, customKinds);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={
        locked
          ? t.columnAlwaysShown(column.label)
          : on
            ? t.hideColumn(column.label)
            : t.showColumn(column.label)
      }
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
      {locked ? `${column.label}*` : column.label}
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
  if (STANDARD_COLUMN_KINDS.includes(col.kind)) {
    const kind = col.kind as Parameters<typeof kindVar>[0];
    return {
      tint: kindVar(kind, "tint"),
      ink: kindVar(kind, "ink"),
      border: kindVar(kind, "border"),
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

/** The "+N hidden" peek pill (design 1.23 pin 2): sits at the end of a
 *  figure's column-header row when the filter hides columns this figure uses.
 *  Tap to peek (this figure shows everything, label flips to "– hide");
 *  collapses on the next scroll. */
function PeekPill({ count, peeked, onTap }: { count: number; peeked: boolean; onTap: () => void }) {
  const t = useMessages(timelineMessages);
  return (
    <button
      type="button"
      aria-expanded={peeked}
      aria-label={peeked ? t.peekCollapseLabel : t.peekHiddenLabel(count)}
      onClick={onTap}
      className="min-h-[36px] flex-none cursor-pointer rounded-[6px] bg-surface-sunken px-2 py-1 text-[10px] font-bold leading-none text-ink-muted"
    >
      {peeked ? t.peekCollapse : t.hiddenCountPill(count)}
    </button>
  );
}

/** The kind ids with a `--bf-kind-*` token family (headers + filter chips). */
const STANDARD_COLUMN_KINDS = [
  "direction",
  "footwork",
  "footPosition",
  "rise",
  "position",
  "bodyActions",
  "sway",
  "turn",
];

/** A column's header/text color — the kind's base token, slate for unknowns. */
function columnColor(col: ReadingColumn): string {
  return STANDARD_COLUMN_KINDS.includes(col.kind)
    ? kindVar(col.kind as Parameters<typeof kindVar>[0])
    : "var(--bf-ink-secondary)";
}

/** One step row: count cell + a chip-or-dot per used column. Off-beat (sub-beat)
 *  rows render dimmed (muted surface + slate count). */
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
    <li className="flex flex-col gap-[3px]">
      <div
        data-offbeat={offBeat ? "true" : undefined}
        className="flex min-h-[44px] items-center gap-1 rounded-[8px] bg-surface-muted px-[5px] py-[5px]"
      >
        <span
          className={cx(
            "w-[18px] flex-none text-center font-bold text-accent tabular-nums",
            offBeat ? "text-[10px]" : "text-[12px]",
          )}
        >
          {label}
        </span>
        {columns.map((col) => {
          const label = cellValue(here, col);
          return (
            <span key={col.id} className="flex flex-1 justify-center">
              {label ? (
                <button
                  type="button"
                  aria-label={t.aboutValue(col.label, label)}
                  onClick={() => onOpenInfo(col)}
                  className="cursor-pointer"
                >
                  <AttrChip kind={col.kind} label={label} />
                </button>
              ) : (
                <EmptySlot />
              )}
            </span>
          );
        })}
      </div>
      {/* Render the comment block whenever there's something to read OR the user
          may add the FIRST comment — so "+ add comment" is reachable at zero. */}
      {(comments.length > 0 || canComment) && (
        <InlineComments
          comments={comments}
          figureId={figureId}
          count={count}
          canComment={canComment}
          memberColors={memberColors}
          memberNames={memberNames}
          onOpenThread={onOpenThread}
        />
      )}
    </li>
  );
}

/** Inline comments under a step: the latest ~2 read-only (truncated, an
 *  author-coloured avatar with the author's initial + Caveat text), a "+N more"
 *  hint, plus an "✎ Add note" affordance shown only to a member who may comment
 *  (commenter/editor — never a pure viewer). Tapping any of them opens the
 *  annotation thread for this specific anchor (QUAL-2 fix: passes { figureRef,
 *  count } so the thread panel opens on the right anchor — not the figure
 *  timeline). */
function InlineComments({
  comments,
  figureId,
  count,
  canComment,
  memberColors,
  memberNames,
  onOpenThread,
}: {
  comments: Annotation[];
  figureId: string;
  count: number;
  canComment: boolean;
  /** Real `authorId → stored hex` map — use this first; hash-fallback only for
   *  unknown authors (e.g. very old annotations before T8 wired identity). */
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
  onOpenThread?: (anchor: { figureRef: string; count?: number }) => void;
}) {
  const t = useMessages(timelineMessages);
  const latest = comments.slice(-2);
  const more = Math.max(0, comments.length - latest.length);
  const anchor = { figureRef: figureId, count };
  return (
    <div className="ml-[22px] flex flex-col gap-[2px]">
      {latest.map((c) => (
        <CommentLine
          key={c.id}
          comment={c}
          memberColors={memberColors}
          memberNames={memberNames}
          onClick={() => onOpenThread?.(anchor)}
        />
      ))}
      <div className="flex items-center gap-[10px]">
        {more > 0 && (
          <button
            type="button"
            className="min-h-[36px] py-2 text-left text-2xs font-bold text-accent"
            onClick={() => onOpenThread?.(anchor)}
          >
            {t.moreComments(more)}
          </button>
        )}
        {canComment && <AddNoteButton onClick={() => onOpenThread?.(anchor)} />}
      </div>
    </div>
  );
}

/** One truncated read-only comment line: the author's identity-coloured avatar
 *  (initial inside — colour is never the only signal, #5) + Caveat text. */
function CommentLine({
  comment,
  memberColors,
  memberNames,
  onClick,
}: {
  comment: Annotation;
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
  onClick: () => void;
}) {
  const name = memberNames?.[comment.authorId];
  return (
    <button type="button" className="flex items-center gap-[6px] text-left" onClick={onClick}>
      <span
        aria-hidden="true"
        className="flex h-[15px] w-[15px] flex-none items-center justify-center rounded-full text-[8px] font-bold text-ink-inverse"
        style={{ background: memberColors?.[comment.authorId] ?? identityColor(comment.authorId) }}
      >
        {authorInitial(name)}
      </span>
      {name && <span className="bf-sr-only">{name}:</span>}
      <span
        className="flex-1 truncate text-[13px] text-ink-secondary"
        style={{ fontFamily: "var(--bf-font-note)" }}
      >
        {comment.text}
      </span>
    </button>
  );
}

/** The "✎ Add note" affordance (Builder v2) — accent-coloured with a ≥36px hit
 *  area, replacing the old faint "+ add comment" hint. */
function AddNoteButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const t = useMessages(timelineMessages);
  return (
    <button
      type="button"
      className="inline-flex min-h-[36px] items-center gap-[5px] py-2 text-left text-2xs font-bold text-accent"
      onClick={onClick}
    >
      <span aria-hidden="true">✎</span> {label ?? t.addNote}
    </button>
  );
}

/** The author's display initial for the comment avatar — empty when unknown. */
function authorInitial(name: string | undefined): string {
  return name?.trim().charAt(0).toUpperCase() ?? "";
}

/** WHOLE-FIGURE notes (US-004a): a note block under the figure header, distinct
 *  from per-step threads. Shows a "WHOLE FIGURE" label, the latest ~2 notes
 *  (truncated), a "+N more" hint, and a "+ note on whole figure" affordance for a
 *  commenter. Tapping any opens the figure-level thread (a figure anchor, no
 *  count). */
function WholeFigureNotes({
  comments,
  figureId,
  canComment,
  memberColors,
  memberNames,
  onOpenThread,
}: {
  comments: Annotation[];
  figureId: string;
  canComment: boolean;
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
  onOpenThread?: (anchor: { figureRef: string; count?: number }) => void;
}) {
  const t = useMessages(timelineMessages);
  const latest = comments.slice(-2);
  const more = Math.max(0, comments.length - latest.length);
  const anchor = { figureRef: figureId };
  return (
    <div data-testid="whole-figure-notes" className="ml-[15px] flex flex-col gap-[2px]">
      <span className="self-start rounded-[4px] bg-accent-tint px-[5px] py-[1px] text-[7px] font-bold uppercase tracking-wider text-accent">
        {t.wholeFigure}
      </span>
      {latest.map((c) => (
        <CommentLine
          key={c.id}
          comment={c}
          memberColors={memberColors}
          memberNames={memberNames}
          onClick={() => onOpenThread?.(anchor)}
        />
      ))}
      <div className="flex items-center gap-[10px]">
        {more > 0 && (
          <button
            type="button"
            className="min-h-[36px] py-2 text-left text-2xs font-bold text-accent"
            onClick={() => onOpenThread?.(anchor)}
          >
            {t.moreComments(more)}
          </button>
        )}
        {canComment && (
          <AddNoteButton label={t.addNoteWholeFigure} onClick={() => onOpenThread?.(anchor)} />
        )}
      </div>
    </div>
  );
}

/** A stable identity color slot for an author (profile-colored comment dot). */
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
