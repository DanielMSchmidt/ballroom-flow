// Reading / timeline view (PLAN §4.3 "reading view", the .pen AssembleReading).
// A read-only layout of the WHOLE routine. Each section is a labelled divider;
// each figure is a compact TABLE: a count + step headline (the direction, e.g.
// "forward") on the left, then five technique columns (Rise · Body · Footwork ·
// Sway · Turn)
// where a placed attribute shows as a tight color-coded code and an empty slot
// shows a small dot. Pure presentation over the same store reads; no editing.
import { type Attribute, countLabel, type FigureDoc, type RoutineDoc } from "@ballroom/domain";
import type { ResolvedPlacement } from "../store/routine";
import { kindVar, ScopeBadge } from "../ui";
import type { FigureScope } from "../ui/tokens";
import { ATTR_COLUMNS, abbrevValue, COLUMN_KINDS, stepAction } from "./attribute-display";
import { chipTone } from "./role-view";

export function RoutineReadingView({
  routine,
  placements,
}: {
  routine: RoutineDoc;
  placements: ResolvedPlacement[];
}) {
  const figureByPlacement = new Map(placements.map((p) => [p.placement.id, p.figure]));
  return (
    <div data-testid="reading-view" className="flex flex-col gap-5">
      {routine.sections.length === 0 ? (
        <p className="text-2xs text-ink-faint">This routine has no sections yet.</p>
      ) : (
        routine.sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.5px] text-ink-faint">
                {section.name}
              </h2>
              <div className="h-px flex-1 bg-border-subtle" aria-hidden="true" />
            </div>
            {section.placements.length === 0 ? (
              <p className="text-2xs text-ink-faint">No figures in this section.</p>
            ) : (
              section.placements.map((pl) => (
                <FigureReadout key={pl.id} figure={figureByPlacement.get(pl.id) ?? null} />
              ))
            )}
          </section>
        ))
      )}
    </div>
  );
}

/** The figure's scope, for the header badge (variant wins over its base scope). */
function figureScope(figure: FigureDoc): FigureScope {
  if (figure.baseFigureRef) return "variant";
  return figure.scope === "global" ? "global" : "custom";
}

/** One figure's notation, read-only: a compact count × technique-column table. */
function FigureReadout({ figure }: { figure: FigureDoc | null }) {
  if (!figure) return null;
  const live = figure.attributes.filter((a) => a.deletedAt == null);
  const counts = [...new Set(live.map((a) => a.count))].sort((a, b) => a - b);
  return (
    <div className="flex flex-col gap-[7px]">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-bold text-ink">{figure.name}</h3>
        <ScopeBadge scope={figureScope(figure)} compact />
        <div className="flex-1" aria-hidden="true" />
        {counts.length > 0 && (
          <span
            className="rounded-[7px] px-2 py-[3px] text-[10px] font-bold"
            style={{ background: kindVar("direction", "tint"), color: kindVar("direction", "ink") }}
          >
            {counts.map((c) => countLabel(c)).join(" · ")}
          </span>
        )}
      </div>

      {counts.length === 0 ? (
        <p className="text-2xs text-ink-faint">No steps noted yet.</p>
      ) : (
        <>
          <ColumnHeader />
          <ol className="flex flex-col gap-[6px]" aria-label={`${figure.name} steps`}>
            {counts.map((count) => (
              <StepRow key={count} count={count} attrs={live} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/** The technique column header: "STEP & COUNT" then the five color-coded codes. */
function ColumnHeader() {
  return (
    <div className="flex items-center px-[6px] pb-[2px] pt-1" aria-hidden="true">
      <span className="w-[22px]" />
      <span className="flex-1 text-[8px] font-bold tracking-[0.3px] text-ink-faint">
        STEP &amp; COUNT
      </span>
      {ATTR_COLUMNS.map((col) => (
        <span
          key={col.code}
          className="w-[30px] text-center text-[8px] font-bold"
          style={{ color: kindVar(col.tone) }}
        >
          {col.code}
        </span>
      ))}
    </div>
  );
}

/** One step row: count + headline (+ extra chips) + the five technique cells. */
function StepRow({ count, attrs }: { count: number; attrs: Attribute[] }) {
  const here = attrs.filter((a) => a.count === count);
  const direction = here.find((a) => a.kind === "direction")?.value;
  // Kinds without a column (body actions, custom, legacy "step") ride along with
  // the headline as small chips so nothing is hidden.
  const extras = here.filter((a) => a.kind !== "direction" && !COLUMN_KINDS.has(a.kind));
  return (
    <li className="flex items-center gap-[5px] rounded-[11px] border border-[#dbe5f0] bg-surface px-[7px] py-[9px]">
      <span
        className="w-[22px] flex-none text-center text-sm font-bold tabular-nums"
        style={{ color: kindVar("direction") }}
      >
        {countLabel(count)}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-[5px]">
        <span className="truncate text-[11px] font-bold text-ink">{stepAction(direction)}</span>
        {extras.map((a) => (
          <MiniChip key={a.id} kind={a.kind} value={a.value} />
        ))}
      </span>
      {ATTR_COLUMNS.map((col) => {
        const a = col.kinds.map((k) => here.find((x) => x.kind === k)).find(Boolean);
        return (
          <span key={col.code} className="flex w-[30px] flex-none justify-center">
            {a ? <MiniChip kind={a.kind} value={a.value} tone={col.tone} /> : <EmptySlot />}
          </span>
        );
      })}
    </li>
  );
}

/** A tight, color-coded attribute code (the cell payload). */
function MiniChip({
  kind,
  value,
  tone: toneProp,
}: {
  kind: string;
  value: unknown;
  tone?: ReturnType<typeof chipTone>;
}) {
  const tone = toneProp ?? chipTone(kind);
  const style =
    tone === "neutral"
      ? {
          background: "var(--bf-surface-sunken)",
          color: "var(--bf-ink-secondary)",
          borderColor: "var(--bf-border-strong)",
        }
      : {
          background: kindVar(tone, "tint"),
          color: kindVar(tone, "ink"),
          borderColor: kindVar(tone),
        };
  return (
    <span
      className="inline-flex items-center rounded-[5px] border px-[4px] py-[2px] text-[8px] font-bold leading-none"
      style={style}
    >
      {abbrevValue(kind, value)}
    </span>
  );
}

/** An empty technique slot — a small ring dot (nothing logged here). */
function EmptySlot() {
  return (
    <span
      aria-hidden="true"
      className="h-[6px] w-[6px] rounded-full border-[1.5px] border-[#ddd6ca]"
    />
  );
}
