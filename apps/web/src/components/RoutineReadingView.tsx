// Reading / timeline view (PLAN §4.3 "reading view", the .pen AssembleReading).
// A read-only layout of the WHOLE routine: each section's figures laid out with
// their notated steps as chips — the payoff view that makes the notation visible
// (great for a coach reviewing, or anyone sharing a read-only routine). Pure
// presentation over the same store reads; no editing here.
import { countLabel, type FigureDoc, type RoutineDoc } from "@ballroom/domain";
import type { ResolvedPlacement } from "../store/routine";
import { Card, Chip } from "../ui";

/** A displayable label for an attribute value (string, or a joined multi-set). */
const displayValue = (value: unknown): string =>
  Array.isArray(value) ? value.map(String).join(", ") : String(value);

export function RoutineReadingView({
  routine,
  placements,
}: {
  routine: RoutineDoc;
  placements: ResolvedPlacement[];
}) {
  const figureByPlacement = new Map(placements.map((p) => [p.placement.id, p.figure]));
  return (
    <div data-testid="reading-view" className="flex flex-col gap-4">
      {routine.sections.length === 0 ? (
        <p className="text-2xs text-ink-faint">This routine has no sections yet.</p>
      ) : (
        routine.sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-ink">{section.name}</h2>
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

/** One figure's notation, read-only: its steps (counts that carry attributes). */
function FigureReadout({ figure }: { figure: FigureDoc | null }) {
  if (!figure) return null;
  const live = figure.attributes.filter((a) => a.deletedAt == null);
  const counts = [...new Set(live.map((a) => a.count))].sort((a, b) => a - b);
  return (
    <Card>
      <h3 className="font-medium text-ink">{figure.name}</h3>
      {counts.length === 0 ? (
        <p className="mt-1 text-2xs text-ink-faint">No steps noted yet.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1" aria-label={`${figure.name} steps`}>
          {counts.map((count) => (
            <li key={count} className="flex items-center gap-2">
              <span className="min-w-[2.5rem] text-2xs text-ink-muted">{countLabel(count)}</span>
              <span className="flex flex-wrap gap-1">
                {live
                  .filter((a) => a.count === count)
                  .map((a) => (
                    <Chip key={a.id} asStatic tone="neutral">
                      {displayValue(a.value)}
                    </Chip>
                  ))}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
