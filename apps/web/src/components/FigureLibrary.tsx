// US-032 — the application-global figure library browse (the Library tab). PLAN
// §4.2: a first-class browse surface over the bundled catalog (library.ts),
// grouped by figureType family and filtered by dance. v1 is READ-ONLY browse —
// figures are added to a routine from the Assemble "Add figure" picker (which
// reuses the same catalog), and variants/copy-on-write are a later slice.
import { DANCE_IDS, type DanceId, libraryGroupsForDance } from "@ballroom/domain";
import { useState } from "react";
import { Card, Select } from "../ui";

/** Humanize a dance id for display ("viennese_waltz" → "Viennese Waltz"). */
function danceLabel(d: DanceId): string {
  return d
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function FigureLibrary({ initialDance = "waltz" }: { initialDance?: DanceId }) {
  const [dance, setDance] = useState<DanceId>(initialDance);
  const groups = libraryGroupsForDance(dance);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">Figure library</h1>
        <p className="text-2xs text-ink-muted">
          The standard figures for each dance. Add one to a routine from “Add figure” while editing.
        </p>
      </header>

      <Select
        label="Dance"
        value={dance}
        options={DANCE_IDS.map((d) => ({ value: d, label: danceLabel(d) }))}
        onChange={(e) => setDance(e.target.value as DanceId)}
      />

      <ul className="flex flex-col gap-2">
        {groups.map((group) => (
          <li key={group.figureType}>
            <Card>
              <h3 className="font-medium text-ink">{group.figures[0]?.name ?? group.figureType}</h3>
              {group.figures.length > 1 && (
                <p className="mt-0.5 text-2xs text-ink-faint">{group.figures.length} variations</p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
