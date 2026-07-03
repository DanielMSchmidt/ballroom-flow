// US-032 — the application-global figure library browse (the Library tab). PLAN
// §4.2: a first-class browse surface over the bundled catalog (library.ts),
// grouped by figureType family and filtered by dance (chips, frames 2.1/2.2).
// Each global card carries a "↟ save" affordance (T5) that promotes the figure
// into the user's personal library as a FROZEN account-figure copy (§5.2).
//
// US-033 — "My figures" tab (frames 2.3/2.4): the user's saved copies + custom
// figures with lineage ("based on X" / "your own figure"), a two-state ScopeBadge
// (Library-derived vs Custom), "used in N routines", an edit affordance, a dance
// filter, and a guided empty-per-dance state. Data is injected via the `loadMine`
// + `onSaveToLibrary` props (the live screen sources them from `store/figures.ts`,
// the only layer permitted to touch lib/rpc).
import {
  DANCE_IDS,
  type DanceId,
  LIBRARY_FIGURES,
  type LibraryFigure,
  libraryGroupsForFilter,
} from "@ballroom/domain";
import { useEffect, useMemo, useState } from "react";
import type { MineFigure, SaveToLibraryResult } from "../store/figures";
import { useFirstVisitTour } from "../tour/useFirstVisitTour";
import { Card, Chip, EditIcon, EmptyState, IconButton, SectionDivider, useToast } from "../ui";

/** The dance filter is a real dance or the "all" cross-dance view. */
type DanceFilter = DanceId | "all";

/** The identity a save-to-library promotion needs (a specific catalog figure). */
export interface SaveLibraryInput {
  dance: DanceId;
  figureType: string;
  name: string;
}

/** Humanize a dance id for display ("viennese_waltz" → "Viennese Waltz"). */
function danceLabel(d: DanceId): string {
  return d
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Humanize a figureType slug for a family heading ("feather-step" → "Feather Step"). */
function typeLabel(figureType: string): string {
  return figureType
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** A small scope dot — color carries scope but never alone (paired with words/icons elsewhere). */
function ScopeDot({ scope }: { scope: "global" | "custom" }) {
  return (
    <span
      aria-hidden="true"
      className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
      style={{
        background:
          scope === "global" ? "var(--bf-scope-global-ink)" : "var(--bf-scope-custom-ink)",
      }}
    />
  );
}

/** The dance filter chip row (All + every Standard dance). */
function DanceChips({
  value,
  onChange,
}: {
  value: DanceFilter;
  onChange: (v: DanceFilter) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: single-select filter chips (each a real <button>); role="group" labels the set without a <fieldset>'s form semantics.
    <div
      role="group"
      aria-label="Filter by dance"
      data-tour="library-filter"
      className="flex flex-wrap gap-2"
    >
      <Chip tone="accent" selected={value === "all"} onClick={() => onChange("all")}>
        All
      </Chip>
      {DANCE_IDS.map((d) => (
        <Chip key={d} tone="accent" selected={value === d} onClick={() => onChange(d)}>
          {danceLabel(d)}
        </Chip>
      ))}
    </div>
  );
}

/** Resolve the source figure's display name for a saved figure's lineage line. */
function baseFigureName(f: MineFigure): string {
  if (f.dance && f.figureType) {
    const origin = LIBRARY_FIGURES.find(
      (l) => l.dance === f.dance && l.figureType === f.figureType,
    );
    if (origin) return origin.name;
  }
  return f.figureType ? typeLabel(f.figureType) : "a library figure";
}

/** The "saved"/"custom" lineage chip on a My-figures card (Builder v2): amber
 *  word-chip — "saved" for a catalog-derived copy, "custom" for a from-scratch
 *  figure. Word + colour together (#5). */
function MineBadge({ saved }: { saved: boolean }) {
  return (
    <span
      className="rounded-[5px] px-1.5 py-0.5 text-2xs font-semibold"
      style={{
        background: "var(--bf-scope-custom-tint)",
        color: "var(--bf-scope-custom)",
      }}
    >
      {saved ? "saved" : "custom"}
    </span>
  );
}

/** The "My figures" personal-library tab (frames 2.3/2.4). */
function PersonalLibrary({ loadMine }: { loadMine?: () => Promise<MineFigure[]> }) {
  const [mine, setMine] = useState<MineFigure[] | null>(null);
  const [dance, setDance] = useState<DanceFilter>("all");

  useEffect(() => {
    if (!loadMine) return;
    let alive = true;
    loadMine().then((figs) => {
      if (alive) setMine(figs);
    });
    return () => {
      alive = false;
    };
  }, [loadMine]);

  const figures = mine ?? [];
  const visible = dance === "all" ? figures : figures.filter((f) => f.dance === dance);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">Figure Library</h1>
        <p className="text-2xs text-ink-muted">
          {dance === "all"
            ? "the shared figure catalogue · filter by dance"
            : `Filter: ${danceLabel(dance)}`}
        </p>
      </header>

      <DanceChips value={dance} onChange={setDance} />

      <div className="flex items-center gap-2">
        <ScopeDot scope="custom" />
        <SectionDivider label="My figures" />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing in My figures for this dance yet"
          description="↟ save a catalog figure and it lands here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((f) => (
            <li key={f.docRef}>
              <Card style={{ background: "var(--bf-scope-custom-tint)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <ScopeDot scope="custom" />
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-medium text-ink">{f.title ?? f.figureType}</h2>
                        <MineBadge saved={Boolean(f.baseFigureRef)} />
                      </div>
                      <p className="text-2xs text-ink-faint">
                        <span style={{ fontFamily: "var(--bf-font-note)" }}>
                          {f.baseFigureRef ? `based on ${baseFigureName(f)}` : "your own figure"}
                        </span>{" "}
                        ·{" "}
                        {f.usedInCount === 0
                          ? "not in a choreo yet"
                          : `used in ${f.usedInCount} ${f.usedInCount === 1 ? "choreo" : "choreos"}`}
                      </p>
                    </div>
                  </div>
                  <IconButton label={`Edit ${f.title ?? "figure"}`} variant="plain">
                    <EditIcon size={18} />
                  </IconButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FigureLibrary({
  initialDance = "all",
  tab = "all",
  loadMine,
  onSaveToLibrary,
  onViewMine,
}: {
  initialDance?: DanceFilter;
  tab?: "all" | "mine";
  loadMine?: () => Promise<MineFigure[]>;
  onSaveToLibrary?: (input: SaveLibraryInput) => Promise<Pick<SaveToLibraryResult, "alreadySaved">>;
  /** Switch to the "My figures" segment — the save-toast's "View" action
   *  (Builder v2: "Saved to My figures · View"). */
  onViewMine?: () => void;
}) {
  const toast = useToast();
  // First-visit tour: the Catalog/My-figures split, the dance filter, ↟ save.
  useFirstVisitTour("library");
  const [dance, setDance] = useState<DanceFilter>(initialDance);
  const [saving, setSaving] = useState<string | null>(null);

  const groups = useMemo(() => libraryGroupsForFilter(dance), [dance]);

  if (tab === "mine") {
    return <PersonalLibrary loadMine={loadMine} />;
  }

  async function handleSave(fig: LibraryFigure) {
    if (!onSaveToLibrary) return;
    const key = `${fig.dance}:${fig.figureType}:${fig.name}`;
    setSaving(key);
    try {
      const res = await onSaveToLibrary({
        dance: fig.dance,
        figureType: fig.figureType,
        name: fig.name,
      });
      toast.show(res.alreadySaved ? "Already in My figures" : "Saved to My figures", {
        tone: res.alreadySaved ? "neutral" : "success",
        action: onViewMine ? { label: "View", onClick: onViewMine } : undefined,
      });
    } catch {
      toast.show("Couldn't save to My figures", { tone: "danger" });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">Figure Library</h1>
        <p className="text-2xs text-ink-muted">the shared figure catalogue · filter by dance</p>
      </header>

      <DanceChips value={dance} onChange={setDance} />

      <div className="flex items-center gap-2">
        <ScopeDot scope="global" />
        <SectionDivider label={dance === "all" ? "Catalog" : `Catalog · ${danceLabel(dance)}`} />
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <section key={group.figureType} className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-ink">{typeLabel(group.figureType)}</h2>
            <ul className="flex flex-col gap-2">
              {group.figures.map((fig) => {
                const key = `${fig.dance}:${fig.figureType}:${fig.name}`;
                return (
                  <li key={key}>
                    <Card>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2">
                          <ScopeDot scope="global" />
                          <div className="flex flex-col gap-1">
                            <h3 className="font-medium text-ink">{fig.name}</h3>
                            {dance === "all" && (
                              <div className="flex flex-wrap gap-1">
                                <Chip tone="neutral" asStatic className="px-2 py-0.5 text-2xs">
                                  {danceLabel(fig.dance)}
                                </Chip>
                              </div>
                            )}
                          </div>
                        </div>
                        {onSaveToLibrary && (
                          <button
                            type="button"
                            aria-label={`Save ${fig.name} to My figures`}
                            data-tour="library-save"
                            onClick={() => handleSave(fig)}
                            disabled={saving === key}
                            className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-[9px] border-[1.5px] px-3 py-2 text-2xs font-bold disabled:opacity-50"
                            style={{
                              borderColor: "var(--bf-scope-custom-border)",
                              color: "var(--bf-scope-custom)",
                              background: "var(--bf-surface)",
                            }}
                          >
                            <span aria-hidden="true">↟</span> save
                          </button>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
