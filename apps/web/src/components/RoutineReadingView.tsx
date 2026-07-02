// Reading lens (design frame 1.6 — Assemble · READING). A clean, read-only
// "programme" of the whole routine: a STEPS-FOR Leader/Follower toggle, then per
// section a SectionDivider, then per figure a compact table whose columns are
// ONLY the attribute kinds that figure uses (the Step column merges direction +
// footwork into one blue chip). Off-beat (sub-beat) rows render dimmed. Inline
// comments surface the latest annotations on a step and open the thread.
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
import { useState } from "react";
import type { FigureLoadStatus, ResolvedPlacement } from "../store/routine";
import {
  AttrChip,
  CountPill,
  cx,
  IDENTITY_COLORS,
  kindVar,
  SectionDivider,
  SegmentedToggle,
  Skeleton,
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
  onRoleViewChange,
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
  /** The active Leader/Follower lens (controlled — persisted by the caller). */
  roleView: RoleView;
  onRoleViewChange: (view: RoleView) => void;
  /** Tap a figure name → Figure detail (existing open-figure flow). */
  onOpenFigure?: (figureId: string) => void;
  /** Tap a comment / "+ add comment" → open the annotation thread for that
   *  anchor (QUAL-2 fix: passes the specific figureRef + count, not just the
   *  figure id, so the caller can focus the panel on the right anchor). A
   *  whole-figure note omits `count` (US-004a). */
  onOpenThread?: (anchor: { figureRef: string; count?: number }) => void;
}) {
  const resolvedByPlacement = new Map(placements.map((p) => [p.placement.id, p]));
  const dance = routine.dance as DanceId;
  // Continuous beat numbering (US-004a): one running counter threads the whole
  // routine in placement order, wrapping at the dance's phrase length. Breaks
  // advance it too. We compute it ONCE here and hand each placement its result;
  // the edit view keeps per-figure LOCAL counts (this is display-only).
  const numberByPlacement = numberRoutineBeats_forRoutine(
    routine,
    resolvedByPlacement,
    roleView,
    dance,
  );
  return (
    <div data-testid="reading-view" className="flex flex-col gap-[10px]">
      <div data-tour="role-toggle" className="flex items-center gap-2">
        <span className="text-2xs font-bold uppercase tracking-wider text-ink-label">
          Steps for
        </span>
        <SegmentedToggle<RoleView>
          ariaLabel="Steps for"
          value={roleView}
          onChange={onRoleViewChange}
          options={[
            { value: "leader", label: "Leader" },
            { value: "follower", label: "Follower" },
          ]}
        />
      </div>

      {routine.sections.length === 0 ? (
        <p className="text-2xs text-ink-faint">This choreo has no sections yet.</p>
      ) : (
        routine.sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-[9px]">
            <SectionDivider label={section.name} />
            {section.placements.length === 0 ? (
              <p className="text-2xs text-ink-faint">No figures in this section.</p>
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
                return (
                  <FigureReadout
                    key={pl.id}
                    figure={rp?.figure ?? null}
                    status={rp?.status ?? "loading"}
                    dance={dance}
                    roleView={roleView}
                    beatTokens={numbered?.kind === "figure" ? numbered.tokens : []}
                    annotations={annotations}
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
  routine: RoutineDoc,
  resolved: Map<string, ResolvedPlacement>,
  roleView: RoleView,
  dance: DanceId,
): Map<string, NumberedBeatEntry | undefined> {
  const beatsPerBar = DANCES[dance].beatsPerBar;
  const ids: string[] = [];
  const entries: RoutineBeatEntry[] = [];
  for (const section of routine.sections) {
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
      <span className="text-2xs font-bold uppercase tracking-wider text-ink-muted">Break</span>
      <span className="text-2xs text-ink-muted">{span}</span>
      <span className="text-2xs font-medium text-ink-faint">
        · {bars} bar{bars === 1 ? "" : "s"}
      </span>
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

/** One figure's notation, read-only: a compact count × used-columns table. */
function FigureReadout({
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
  onOpenFigure?: (figureId: string) => void;
  onOpenThread?: (anchor: { figureRef: string; count?: number }) => void;
}) {
  // The attribute kind whose info overlay is open (frame 1.13), or null. Tapping
  // a value chip or a column header opens the plain-language reference. State is
  // per-figure so usage counts + columns are scoped to the figure that was tapped.
  const [infoCol, setInfoCol] = useState<ReadingColumn | null>(null);
  if (!figure) {
    // A loading figure shows a skeleton (never silently vanishes); a genuinely
    // unavailable one says so plainly. A transient error reads as unavailable
    // too — this is the read-only view, so there's no retry affordance here.
    if (status === "missing" || status === "error") {
      return (
        <p className="text-2xs text-ink-faint" role="status">
          This figure is unavailable.
        </p>
      );
    }
    return (
      <div aria-busy="true">
        <Skeleton className="w-32" />
        <span className="sr-only" role="status">
          Loading figure…
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
  const columns = usedColumns(live, dance);
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
          <span className="text-2xs font-medium text-ink-muted">
            {bars} bar{bars === 1 ? "" : "s"}
          </span>
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
        <p className="text-2xs text-ink-faint">No steps noted yet.</p>
      ) : (
        <>
          <ColumnHeader columns={columns} onOpenInfo={setInfoCol} />
          <ol className="flex flex-col gap-[5px]" aria-label={`${figure.name} steps`}>
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
                  positionLabel: `${idx + 1} of ${columns.length}`,
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
}

/** The per-figure column header: a count gutter then each used kind in its
 *  kind color (frame 1.6: Step · Rise · Pos · Sway · Turn). Each kind label is a
 *  button that opens that kind's attribute info overlay (frame 1.13). */
function ColumnHeader({
  columns,
  onOpenInfo,
}: {
  columns: ReadingColumn[];
  onOpenInfo: (col: ReadingColumn) => void;
}) {
  return (
    <div className="flex min-h-[40px] items-center gap-1 px-[2px]">
      <span className="w-[18px] flex-none" aria-hidden="true" />
      {columns.map((col) => (
        <button
          key={col.id}
          type="button"
          aria-label={`About ${col.label}`}
          onClick={() => onOpenInfo(col)}
          className="flex-1 cursor-pointer py-3 text-center text-2xs font-bold leading-none tracking-wide"
          style={{ color: columnColor(col) }}
        >
          {col.label}
        </button>
      ))}
    </div>
  );
}

/** A column's header/text color — the kind's base token, slate for unknowns. */
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
                  aria-label={`About ${col.label} — ${label}`}
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
            +{more} more
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
function AddNoteButton({ onClick, label = "Add note" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="inline-flex min-h-[36px] items-center gap-[5px] py-2 text-left text-2xs font-bold text-accent"
      onClick={onClick}
    >
      <span aria-hidden="true">✎</span> {label}
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
  const latest = comments.slice(-2);
  const more = Math.max(0, comments.length - latest.length);
  const anchor = { figureRef: figureId };
  return (
    <div data-testid="whole-figure-notes" className="ml-[15px] flex flex-col gap-[2px]">
      <span className="self-start rounded-[4px] bg-accent-tint px-[5px] py-[1px] text-[7px] font-bold uppercase tracking-wider text-accent">
        Whole figure
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
            +{more} more
          </button>
        )}
        {canComment && (
          <AddNoteButton label="Add note — whole figure" onClick={() => onOpenThread?.(anchor)} />
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
  const color = scope === "library" ? kindVar("direction") : kindVar("footwork");
  return (
    <span className="inline-flex flex-none items-center">
      <span
        aria-hidden="true"
        className="h-[9px] w-[9px] rounded-full"
        style={{ background: color }}
      />
      <span className="bf-sr-only">{scope === "library" ? "Library" : "Custom"} figure</span>
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
