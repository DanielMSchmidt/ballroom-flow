// T6 — the Journal link picker (frames 3.4 / 3.5 / 3.7). A bottom-sheet,
// multi-step chooser (TYPE → FIGURE/SCOPE) that produces a JournalLink for the
// entry editor. Per the LOCKED full-parity decision, the routine-scoped paths
// ("Specific place", "This choreo only") are NOT disabled: they let the user pick
// one of THEIR routines and the figure within it, yielding a point/figure anchor
// the editor saves via createAnnotation. The "An attribute" row is the deferred
// v1.1 predicate anchor — visibly disabled. Data arrives via injected loaders
// (the store seam); the component holds no I/O of its own.
import { type Anchor, countLabel, DANCE_IDS, type DanceId } from "@weavesteps/domain";
import { useEffect, useState } from "react";
import { danceName, type Locale, useLocale, useMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";
import { type FigureFamilyOption, figureFamilies } from "../store/journal";
import { Button, Input, List, ListRow, Sheet, Spinner } from "../ui";

/** One of the user's routines (the routine chooser). */
export interface RoutineOption {
  docRef: string;
  title: string;
  dance: string;
}
/** A figure placed in a routine (resolved from its snapshot). */
export interface RoutineFigureOption {
  figureRef: string;
  name: string;
  figureType: string;
  /** The figure's distinct sorted counts, for the "On count N" grain (US-004a). */
  counts: number[];
}

/**
 * A built link the editor stores. `home` decides the save path:
 * routine → createAnnotation on `routineRef`; account → createFamilyNote.
 */
export type JournalLink =
  | { home: "routine"; routineRef: string; routineTitle: string; anchor: Anchor; label: string }
  | {
      home: "account";
      figureType: string;
      danceScope: string;
      anchor: Anchor;
      label: string;
    };

export interface JournalLinkPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (link: JournalLink) => void;
  /** The user's routines (for the routine chooser). */
  loadRoutineOptions: () => Promise<RoutineOption[]>;
  /** A routine's figures (for the figure-in-routine chooser). */
  loadRoutineFigures: (routineRef: string) => Promise<RoutineFigureOption[]>;
  /** The figure-family catalog (defaults to the library catalog). */
  families?: FigureFamilyOption[];
}

type Step = "type" | "family" | "scope" | "routine" | "figureInRoutine" | "figureGrain";
/** Which routine-scoped anchor we're building once a routine+figure is chosen. */
type RoutineIntent = "point" | "figure";

function titleCase(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Display a dance value: the localized name for a known DanceId; anything else
 *  (user/legacy data) falls back to title case, untranslated by design. */
function danceLabel(dance: string, locale: Locale): string {
  return DANCE_IDS.includes(dance as DanceId)
    ? danceName(dance as DanceId, locale)
    : titleCase(dance);
}

export function JournalLinkPicker({
  open,
  onClose,
  onPick,
  loadRoutineOptions,
  loadRoutineFigures,
  families,
}: JournalLinkPickerProps): React.JSX.Element | null {
  const t = useMessages(journalMessages);
  const locale = useLocale();
  const familyList = families ?? figureFamilies();
  const [step, setStep] = useState<Step>("type");
  const [family, setFamily] = useState<FigureFamilyOption | null>(null);
  const [routineIntent, setRoutineIntent] = useState<RoutineIntent>("figure");
  const [routine, setRoutine] = useState<RoutineOption | null>(null);
  const [pickedFigure, setPickedFigure] = useState<RoutineFigureOption | null>(null);

  // Reset to the first step whenever the sheet (re)opens.
  useEffect(() => {
    if (open) {
      setStep("type");
      setFamily(null);
      setRoutine(null);
      setPickedFigure(null);
    }
  }, [open]);

  if (!open) return null;

  const titles: Record<Step, string> = {
    type: t.titleType,
    family: t.titleFamily,
    scope: t.titleScope,
    routine: t.titleRoutine,
    figureInRoutine: routine ? t.titleFigureIn(routine.title) : t.titleFamily,
    figureGrain: pickedFigure ? t.titleGrain(pickedFigure.name) : t.titleGrainFallback,
  };

  /** Finalize a figureType (account) link from the chosen family + dance scope. */
  const pickFigureType = (danceScope: string): void => {
    if (!family) return;
    const scopeLabel =
      danceScope === "all" ? t.allDances : t.scopeAllDance(danceLabel(danceScope, locale));
    onPick({
      home: "account",
      figureType: family.figureType,
      danceScope,
      anchor: {
        type: "figureType",
        figureType: family.figureType,
        danceScope: danceScope as DanceId | "all",
      },
      label: `${t.allOfType(titleCase(family.figureType))} · ${scopeLabel}`,
    });
    onClose();
  };

  /** After a figure in a routine is chosen, ask WHERE on it — the whole figure or
   *  a specific count (US-004a grain step). */
  const pickRoutineFigure = (fig: RoutineFigureOption): void => {
    setPickedFigure(fig);
    setStep("figureGrain");
  };

  /** Finalize a routine-scoped link from the chosen figure + grain. "whole" →
   *  a figure anchor ("Whisk · whole figure"); a count → a point anchor
   *  ("Whisk · count 2"). */
  const finalizeGrain = (grain: "whole" | number): void => {
    if (!routine || !pickedFigure) return;
    const anchor: Anchor =
      grain === "whole"
        ? { type: "figure", figureRef: pickedFigure.figureRef }
        : { type: "point", figureRef: pickedFigure.figureRef, count: grain };
    const label =
      grain === "whole"
        ? t.wholeFigureChip(pickedFigure.name)
        : t.countChip(pickedFigure.name, countLabel(grain));
    onPick({
      home: "routine",
      routineRef: routine.docRef,
      routineTitle: routine.title,
      anchor,
      label,
    });
    onClose();
  };

  const back = (): void => {
    if (step === "family" || step === "routine") setStep("type");
    else if (step === "scope") setStep("family");
    else if (step === "figureInRoutine") setStep(routineIntent === "point" ? "routine" : "scope");
    else if (step === "figureGrain") setStep("figureInRoutine");
  };

  return (
    <Sheet open={open} onClose={onClose} title={titles[step]}>
      {step === "type" && (
        <List aria-label={t.linkTypeList}>
          <ListRow
            title={t.specificPlace}
            subtitle={t.specificPlaceHint}
            onClick={() => {
              setRoutineIntent("point");
              setStep("routine");
            }}
          />
          <ListRow title={t.aFigure} subtitle={t.aFigureHint} onClick={() => setStep("family")} />
          <ListRow
            title={t.anAttribute}
            subtitle={t.anAttributeHint}
            trailing={<span className="text-2xs text-ink-faint">{t.comingLater}</span>}
            showChevron={false}
            disabled
          />
        </List>
      )}

      {step === "family" && (
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" onClick={back}>
            {t.backShort}
          </Button>
          <List aria-label={t.figureFamilies} className="max-h-[60dvh] overflow-y-auto">
            {familyList.map((f) => (
              <ListRow
                key={f.figureType}
                title={f.name}
                subtitle={danceLabel(f.dance, locale)}
                onClick={() => {
                  setFamily(f);
                  setStep("scope");
                }}
              />
            ))}
          </List>
        </div>
      )}

      {step === "scope" && family && (
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" onClick={back}>
            {t.backShort}
          </Button>
          <p className="text-2xs text-ink-muted" style={{ fontFamily: "var(--bf-font-note)" }}>
            {t.linking(t.allOfType(titleCase(family.figureType)))}
          </p>
          <List aria-label={t.linkScope}>
            <ListRow
              title={t.thisChoreoOnly}
              subtitle={t.thisChoreoOnlyHint}
              onClick={() => {
                setRoutineIntent("figure");
                setStep("routine");
              }}
            />
            <ListRow
              title={t.allDanceChoreos(danceLabel(family.dance, locale))}
              subtitle={t.allDanceChoreosHint}
              onClick={() => pickFigureType(family.dance)}
            />
            <ListRow
              title={t.everyDance}
              subtitle={t.everyDanceHint}
              onClick={() => pickFigureType("all")}
            />
          </List>
        </div>
      )}

      {step === "routine" && (
        <RoutineChooser
          loadRoutineOptions={loadRoutineOptions}
          onBack={back}
          onPick={(r) => {
            setRoutine(r);
            setStep("figureInRoutine");
          }}
        />
      )}

      {step === "figureInRoutine" && routine && (
        <FigureInRoutineChooser
          routineRef={routine.docRef}
          familyType={routineIntent === "figure" ? (family?.figureType ?? null) : null}
          loadRoutineFigures={loadRoutineFigures}
          onBack={back}
          onPick={pickRoutineFigure}
        />
      )}

      {step === "figureGrain" && pickedFigure && (
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" onClick={back}>
            {t.backShort}
          </Button>
          <List aria-label={t.figureGrainList}>
            <ListRow
              title={t.entireFigure}
              subtitle={t.entireFigureHint}
              onClick={() => finalizeGrain("whole")}
            />
            {pickedFigure.counts.map((count) => (
              <ListRow
                key={count}
                title={t.onCount(countLabel(count))}
                onClick={() => finalizeGrain(count)}
              />
            ))}
          </List>
        </div>
      )}
    </Sheet>
  );
}

function RoutineChooser({
  loadRoutineOptions,
  onBack,
  onPick,
}: {
  loadRoutineOptions: () => Promise<RoutineOption[]>;
  onBack: () => void;
  onPick: (r: RoutineOption) => void;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  const locale = useLocale();
  const [routines, setRoutines] = useState<RoutineOption[] | null>(null);
  useEffect(() => {
    let live = true;
    loadRoutineOptions().then((r) => {
      if (live) setRoutines(r);
    });
    return () => {
      live = false;
    };
  }, [loadRoutineOptions]);

  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        {t.backShort}
      </Button>
      {routines === null ? (
        <Spinner size={20} label={t.loadingChoreos} />
      ) : routines.length === 0 ? (
        <p className="text-2xs text-ink-muted">{t.noChoreos}</p>
      ) : (
        <List aria-label={t.yourChoreos} className="max-h-[60dvh] overflow-y-auto">
          {routines.map((r) => (
            <ListRow
              key={r.docRef}
              title={r.title || t.untitled}
              subtitle={danceLabel(r.dance, locale)}
              onClick={() => onPick(r)}
            />
          ))}
        </List>
      )}
    </div>
  );
}

function FigureInRoutineChooser({
  routineRef,
  familyType,
  loadRoutineFigures,
  onBack,
  onPick,
}: {
  routineRef: string;
  familyType: string | null;
  loadRoutineFigures: (routineRef: string) => Promise<RoutineFigureOption[]>;
  onBack: () => void;
  onPick: (f: RoutineFigureOption) => void;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  const [figures, setFigures] = useState<RoutineFigureOption[] | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    loadRoutineFigures(routineRef).then((f) => {
      if (live) setFigures(f);
    });
    return () => {
      live = false;
    };
  }, [routineRef, loadRoutineFigures]);

  // For the "A figure · this choreo" path, surface the matching family first;
  // fall back to the whole routine when none match (so the user is never stuck).
  const list = (() => {
    if (!figures) return null;
    const scoped = (() => {
      if (!familyType) return figures;
      const matching = figures.filter((f) => f.figureType === familyType);
      return matching.length > 0 ? matching : figures;
    })();
    const q = query.trim().toLowerCase();
    return q ? scoped.filter((f) => f.name.toLowerCase().includes(q)) : scoped;
  })();

  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        {t.backShort}
      </Button>
      {figures && figures.length > 0 && (
        <Input
          label={t.searchFigures}
          hideLabel
          placeholder={t.searchFiguresPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {list === null ? (
        <Spinner size={20} label={t.loadingFigures} />
      ) : list.length === 0 ? (
        <p className="text-2xs text-ink-muted">
          {query.trim() ? t.noFiguresMatch : t.noFiguresYet}
        </p>
      ) : (
        <List aria-label={t.figuresInChoreo} className="max-h-[60dvh] overflow-y-auto">
          {list.map((f) => (
            <ListRow
              key={f.figureRef}
              title={f.name}
              subtitle={titleCase(f.figureType)}
              onClick={() => onPick(f)}
            />
          ))}
        </List>
      )}
    </div>
  );
}
