// US-032 — Application-global figure library browse [M4]
// US-033 — Account variants + custom figures in library [M4]
//
// PLAN §4.2: browse the application-global library (canonical figures, grouped
// by `figureType`, filterable by dance) and your account variants/custom
// figures (variant badge shows base lineage; "used in N routines"). Editing a
// global figure is auto-variant (US-035), so global figures are surfaced as
// not-directly-editable — the edit affordance lives on the timeline (FE-3 S3).
//
// Presentational (the §3 seam, like ChoreoList): it takes the two figure lists
// + handlers as props and renders + filters; the screen wrapper wires the store
// (GET /api/figures + /api/figures/mine) and navigation. No CRDT, no fork
// machinery here — scope/lineage/usage are projected fields off the D1 index.
import type { FigureListItem } from "@ballroom/contract";
import { DANCE_IDS, type DanceId } from "@ballroom/domain";
import { useMemo, useState } from "react";
import { Badge, EmptyState, LibraryIcon, List, ListRow, ScopeBadge, Select, Tabs } from "../ui";

type LibraryTab = "library" | "mine";

/** Humanize a slug ("viennese_waltz" / "three_step" → "Viennese Waltz" / "Three Step"). */
function humanize(slug: string): string {
  return slug
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const DANCE_OPTIONS = [
  { value: "", label: "All dances" },
  ...DANCE_IDS.map((id) => ({ value: id, label: humanize(id) })),
];

const TABS = [
  { value: "library", label: "Library" },
  { value: "mine", label: "Mine" },
];

/** A figureType family group: the family heading + its figures (post-filter). */
interface FamilyGroup {
  figureType: string;
  label: string;
  figures: FigureListItem[];
}

/** Group figures by `figureType`, applying the dance filter first. Stable order. */
function groupByFamily(figures: FigureListItem[], dance: string): FamilyGroup[] {
  const groups = new Map<string, FamilyGroup>();
  for (const fig of figures) {
    if (dance && fig.dance !== dance) continue;
    let g = groups.get(fig.figureType);
    if (!g) {
      g = { figureType: fig.figureType, label: humanize(fig.figureType), figures: [] };
      groups.set(fig.figureType, g);
    }
    g.figures.push(fig);
  }
  return [...groups.values()];
}

export interface FigureLibraryProps {
  /** Which sub-list is active (controlled-with-fallback); default "library". */
  tab?: LibraryTab;
  /** Application-global canonical figures (app-owned). */
  globalFigures?: FigureListItem[];
  /** The viewer's account variants + custom figures. */
  myFigures?: FigureListItem[];
  /** Open a figure (navigate to its timeline). */
  onOpen?: (docRef: string) => void;
}

/**
 * FigureLibrary — browse global canonical figures + your own variants/custom
 * figures, grouped by family and dance-filterable. Read-only here; editing a
 * global figure auto-variants on the timeline (US-035, FE-3 S3).
 */
export function FigureLibrary({
  tab = "library",
  globalFigures = [],
  myFigures = [],
  onOpen,
}: FigureLibraryProps) {
  const [active, setActive] = useState<LibraryTab>(tab);
  const [dance, setDance] = useState<DanceId | "">("");

  const source = active === "mine" ? myFigures : globalFigures;
  const groups = useMemo(() => groupByFamily(source, dance), [source, dance]);

  return (
    <section className="flex flex-col gap-4" aria-label="Figure library">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          label="Figure library tabs"
          items={TABS}
          value={active}
          onChange={(v) => setActive(v as LibraryTab)}
        />
        <Select
          label="Dance"
          options={DANCE_OPTIONS}
          value={dance}
          onChange={(e) => setDance(e.target.value as DanceId | "")}
          className="min-w-[10rem]"
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon size={28} />}
          title={active === "mine" ? "No figures of your own yet" : "No figures here"}
          description={
            active === "mine"
              ? "Tweak a library figure on its timeline and it becomes your variant — it'll show up here."
              : "No library figures match this dance. Try another dance."
          }
        />
      ) : (
        <ul className="flex list-none flex-col gap-5">
          {groups.map((group) => (
            <li key={group.figureType} className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-ink">{group.label}</h3>
              <List>
                {group.figures.map((fig) => (
                  <ListRow
                    key={fig.docRef}
                    title={fig.name}
                    subtitle={humanize(fig.dance)}
                    onClick={onOpen ? () => onOpen(fig.docRef) : undefined}
                    trailing={
                      <span className="flex items-center gap-1.5">
                        <ScopeBadge scope={fig.scope} lineage={fig.baseName ?? undefined} />
                        {fig.usedInCount != null && (
                          <Badge tone="neutral">
                            {`used in ${fig.usedInCount} ${
                              fig.usedInCount === 1 ? "routine" : "routines"
                            }`}
                          </Badge>
                        )}
                      </span>
                    }
                  />
                ))}
              </List>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
