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
  countLabel,
  type DanceId,
  type FigureDoc,
  figureMatchesLibraryOrigin,
  type RoutineDoc,
} from "@ballroom/domain";
import type { FigureLoadStatus, ResolvedPlacement } from "../store/routine";
import {
  AttrChip,
  CountPill,
  IDENTITY_COLORS,
  kindVar,
  SectionDivider,
  SegmentedToggle,
  Skeleton,
} from "../ui";
import type { FigureScope } from "../ui/tokens";
import { cellValue, isOffBeatCount, type ReadingColumn, usedColumns } from "./reading-columns";
import { filterByRoleView, type RoleView } from "./role-view";

export function RoutineReadingView({
  routine,
  placements,
  annotations = [],
  roleView,
  onRoleViewChange,
  onOpenFigure,
  onOpenThread,
}: {
  routine: RoutineDoc;
  placements: ResolvedPlacement[];
  /** Annotations on this routine — surfaced as inline comments under their step. */
  annotations?: Annotation[];
  /** The active Leader/Follower lens (controlled — persisted by the caller). */
  roleView: RoleView;
  onRoleViewChange: (view: RoleView) => void;
  /** Tap a figure name → Figure detail (existing open-figure flow). */
  onOpenFigure?: (figureId: string) => void;
  /** Tap a comment / "+ add comment" → open the thread for that figure. */
  onOpenThread?: (figureId: string) => void;
}) {
  const resolvedByPlacement = new Map(placements.map((p) => [p.placement.id, p]));
  const dance = routine.dance as DanceId;
  return (
    <div data-testid="reading-view" className="flex flex-col gap-[10px]">
      <div className="flex items-center gap-2">
        <span className="text-2xs font-bold uppercase tracking-wider text-ink-muted">
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
        <p className="text-2xs text-ink-faint">This routine has no sections yet.</p>
      ) : (
        routine.sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-[9px]">
            <SectionDivider label={section.name} />
            {section.placements.length === 0 ? (
              <p className="text-2xs text-ink-faint">No figures in this section.</p>
            ) : (
              section.placements.map((pl) => {
                const rp = resolvedByPlacement.get(pl.id);
                return (
                  <FigureReadout
                    key={pl.id}
                    figure={rp?.figure ?? null}
                    status={rp?.status ?? "loading"}
                    dance={dance}
                    roleView={roleView}
                    annotations={annotations}
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

/** The figure's badge scope, derived by content DIVERGENCE (not the copy
 *  mechanism): a frozen account copy carries its own attributes and `baseFigureRef`
 *  is provenance only — an account figure still matching its catalog origin reads
 *  Library, otherwise Custom (§2.5.1 #19–20). */
function figureScope(figure: FigureDoc): FigureScope {
  if (figure.scope === "global") return "global";
  return figureMatchesLibraryOrigin(figure) ? "global" : "custom";
}

/** One figure's notation, read-only: a compact count × used-columns table. */
function FigureReadout({
  figure,
  status,
  dance,
  roleView,
  annotations,
  onOpenFigure,
  onOpenThread,
}: {
  figure: FigureDoc | null;
  status: FigureLoadStatus;
  dance: DanceId;
  roleView: RoleView;
  annotations: Annotation[];
  onOpenFigure?: (figureId: string) => void;
  onOpenThread?: (figureId: string) => void;
}) {
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
  const columns = usedColumns(live);
  const bars = barsForFigure(counts, dance);
  // Inline comments anchored to a specific step (point) of this figure.
  const figureComments = annotations.filter(
    (a) =>
      a.deletedAt == null &&
      a.anchors.some((an) => an.type === "point" && an.figureRef === figure.id),
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
        {counts.length > 0 && <CountPill counts={counts.map((c) => countLabel(c))} />}
        {counts.length > 0 && (
          <span className="text-2xs font-medium text-ink-muted">
            {bars} bar{bars === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {counts.length === 0 ? (
        <p className="text-2xs text-ink-faint">No steps noted yet.</p>
      ) : (
        <>
          <ColumnHeader columns={columns} />
          <ol className="flex flex-col gap-[5px]" aria-label={`${figure.name} steps`}>
            {counts.map((count) => (
              <StepRow
                key={count}
                count={count}
                columns={columns}
                here={live.filter((a) => a.count === count)}
                comments={figureComments.filter((a) =>
                  a.anchors.some((an) => an.type === "point" && an.count === count),
                )}
                figureId={figure.id}
                onOpenThread={onOpenThread}
              />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/** The per-figure column header: a count gutter then each used kind in its
 *  kind color (frame 1.6: Step · Rise · Pos · Sway · Turn). */
function ColumnHeader({ columns }: { columns: ReadingColumn[] }) {
  return (
    <div className="flex items-center gap-1 px-[2px]" aria-hidden="true">
      <span className="w-[18px] flex-none" />
      {columns.map((col) => (
        <span
          key={col.id}
          className="flex-1 text-center text-[8px] font-bold leading-none"
          style={{ color: columnColor(col) }}
        >
          {col.label}
        </span>
      ))}
    </div>
  );
}

/** A column's header/text color — the kind's base token, slate for unknowns. */
function columnColor(col: ReadingColumn): string {
  const standard = ["direction", "footwork", "rise", "position", "sway", "turn"];
  return standard.includes(col.kind)
    ? kindVar(col.kind as Parameters<typeof kindVar>[0])
    : "var(--bf-ink-secondary)";
}

/** One step row: count cell + a chip-or-dot per used column. Off-beat (sub-beat)
 *  rows render dimmed (muted surface + slate count). */
function StepRow({
  count,
  columns,
  here,
  comments,
  figureId,
  onOpenThread,
}: {
  count: number;
  columns: ReadingColumn[];
  here: Attribute[];
  comments: Annotation[];
  figureId: string;
  onOpenThread?: (figureId: string) => void;
}) {
  const offBeat = isOffBeatCount(count);
  return (
    <li className="flex flex-col gap-[3px]">
      <div
        data-offbeat={offBeat ? "true" : undefined}
        className="flex items-center gap-1 rounded-[7px] px-[2px] py-[5px]"
        style={{ background: offBeat ? "var(--bf-surface-sunken)" : "var(--bf-surface)" }}
      >
        <span
          className="w-[18px] flex-none text-center text-[11px] font-bold tabular-nums"
          style={{ color: offBeat ? "var(--bf-offbeat-ink)" : kindVar("direction") }}
        >
          {countLabel(count)}
        </span>
        {columns.map((col) => {
          const label = cellValue(here, col);
          return (
            <span key={col.id} className="flex flex-1 justify-center">
              {label ? <AttrChip kind={col.kind} label={label} dimmed={offBeat} /> : <EmptySlot />}
            </span>
          );
        })}
      </div>
      {(comments.length > 0 || onOpenThread) && (
        <InlineComments comments={comments} figureId={figureId} onOpenThread={onOpenThread} />
      )}
    </li>
  );
}

/** Inline comments under a step: the latest ~2 (truncated, profile-colored dot +
 *  Caveat text) and a "+ add comment" affordance. Tapping opens the thread. */
function InlineComments({
  comments,
  figureId,
  onOpenThread,
}: {
  comments: Annotation[];
  figureId: string;
  onOpenThread?: (figureId: string) => void;
}) {
  if (comments.length === 0) return null;
  const latest = comments.slice(-2);
  return (
    <div className="ml-[22px] flex flex-col gap-[2px]">
      {latest.map((c) => (
        <button
          key={c.id}
          type="button"
          className="flex items-center gap-[5px] text-left"
          onClick={() => onOpenThread?.(figureId)}
        >
          <span
            aria-hidden="true"
            className="h-[7px] w-[7px] flex-none rounded-full"
            style={{ background: identityColor(c.authorId) }}
          />
          <span
            className="flex-1 truncate text-[13px] text-ink-secondary"
            style={{ fontFamily: "var(--bf-font-note)" }}
          >
            {c.text}
          </span>
        </button>
      ))}
      <button
        type="button"
        className="text-left text-[8px] font-semibold text-ink-faint"
        onClick={() => onOpenThread?.(figureId)}
      >
        + add comment
      </button>
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
  const color = scope === "global" ? kindVar("direction") : kindVar("footwork");
  return (
    <span className="inline-flex flex-none items-center">
      <span
        aria-hidden="true"
        className="h-[9px] w-[9px] rounded-full"
        style={{ background: color }}
      />
      <span className="bf-sr-only">{scope === "global" ? "Library" : "Custom"} figure</span>
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
