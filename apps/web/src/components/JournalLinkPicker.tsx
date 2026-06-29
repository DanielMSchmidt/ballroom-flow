// T6 — the Journal link picker (frames 3.4 / 3.5 / 3.7). A bottom-sheet,
// multi-step chooser (TYPE → FIGURE/SCOPE) that produces a JournalLink for the
// entry editor. Per the LOCKED full-parity decision, the routine-scoped paths
// ("Specific place", "This choreo only") are NOT disabled: they let the user pick
// one of THEIR routines and the figure within it, yielding a point/figure anchor
// the editor saves via createAnnotation. The "An attribute" row is the deferred
// v1.1 predicate anchor — visibly disabled. Data arrives via injected loaders
// (the store seam); the component holds no I/O of its own.
import type { Anchor, DanceId } from "@ballroom/domain";
import { useEffect, useState } from "react";
import { type FigureFamilyOption, figureFamilies } from "../store/journal";
import { Button, List, ListRow, Sheet, Spinner } from "../ui";

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

type Step = "type" | "family" | "scope" | "routine" | "figureInRoutine";
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

export function JournalLinkPicker({
  open,
  onClose,
  onPick,
  loadRoutineOptions,
  loadRoutineFigures,
  families,
}: JournalLinkPickerProps): React.JSX.Element | null {
  const familyList = families ?? figureFamilies();
  const [step, setStep] = useState<Step>("type");
  const [family, setFamily] = useState<FigureFamilyOption | null>(null);
  const [routineIntent, setRoutineIntent] = useState<RoutineIntent>("figure");
  const [routine, setRoutine] = useState<RoutineOption | null>(null);

  // Reset to the first step whenever the sheet (re)opens.
  useEffect(() => {
    if (open) {
      setStep("type");
      setFamily(null);
      setRoutine(null);
    }
  }, [open]);

  if (!open) return null;

  const titles: Record<Step, string> = {
    type: "Link to…",
    family: "Pick a figure",
    scope: "Apply to…",
    routine: "Pick a choreo",
    figureInRoutine: routine ? `Pick a figure in ${routine.title}` : "Pick a figure",
  };

  /** Finalize a figureType (account) link from the chosen family + dance scope. */
  const pickFigureType = (danceScope: string): void => {
    if (!family) return;
    const scopeLabel = danceScope === "all" ? "all dances" : `all ${titleCase(danceScope)}`;
    onPick({
      home: "account",
      figureType: family.figureType,
      danceScope,
      anchor: {
        type: "figureType",
        figureType: family.figureType,
        danceScope: danceScope as DanceId | "all",
      },
      label: `all ${titleCase(family.figureType)}s · ${scopeLabel}`,
    });
    onClose();
  };

  /** Finalize a routine-scoped link once a figure in a routine is chosen. */
  const pickRoutineFigure = (fig: RoutineFigureOption): void => {
    if (!routine) return;
    const anchor: Anchor =
      routineIntent === "point"
        ? { type: "point", figureRef: fig.figureRef, count: 0 }
        : { type: "figure", figureRef: fig.figureRef };
    const label = routineIntent === "point" ? `${fig.name} · step 1` : fig.name;
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
  };

  return (
    <Sheet open={open} onClose={onClose} title={titles[step]}>
      {step === "type" && (
        <List aria-label="Link type">
          <ListRow
            title="Specific place"
            subtitle="a step in one of your choreos"
            onClick={() => {
              setRoutineIntent("point");
              setStep("routine");
            }}
          />
          <ListRow
            title="A figure"
            subtitle="all Whisks, all Natural Turns"
            onClick={() => setStep("family")}
          />
          <ListRow
            title="An attribute"
            subtitle="all CBMPs, all left sways — needs a matching engine"
            trailing={<span className="text-2xs text-ink-faint">coming later · v1.1</span>}
            showChevron={false}
            disabled
          />
        </List>
      )}

      {step === "family" && (
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" onClick={back}>
            ‹ back
          </Button>
          <List aria-label="Figure families" className="max-h-[60dvh] overflow-y-auto">
            {familyList.map((f) => (
              <ListRow
                key={f.figureType}
                title={f.name}
                subtitle={titleCase(f.dance)}
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
            ‹ back
          </Button>
          <p className="text-2xs text-ink-muted" style={{ fontFamily: "var(--bf-font-note)" }}>
            linking: all {titleCase(family.figureType)}s
          </p>
          <List aria-label="Link scope">
            <ListRow
              title="This choreo only"
              subtitle="pick which of your choreos"
              onClick={() => {
                setRoutineIntent("figure");
                setStep("routine");
              }}
            />
            <ListRow
              title={`All ${titleCase(family.dance)} choreos`}
              subtitle="same dance, every routine"
              onClick={() => pickFigureType(family.dance)}
            />
            <ListRow
              title="Every dance"
              subtitle="wherever this appears"
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
        ‹ back
      </Button>
      {routines === null ? (
        <Spinner size={20} label="Loading your choreos" />
      ) : routines.length === 0 ? (
        <p className="text-2xs text-ink-muted">No choreos yet — create one in the Choreo tab.</p>
      ) : (
        <List aria-label="Your choreos" className="max-h-[60dvh] overflow-y-auto">
          {routines.map((r) => (
            <ListRow
              key={r.docRef}
              title={r.title || "Untitled"}
              subtitle={titleCase(r.dance)}
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
  const [figures, setFigures] = useState<RoutineFigureOption[] | null>(null);
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
    if (!familyType) return figures;
    const matching = figures.filter((f) => f.figureType === familyType);
    return matching.length > 0 ? matching : figures;
  })();

  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        ‹ back
      </Button>
      {list === null ? (
        <Spinner size={20} label="Loading figures" />
      ) : list.length === 0 ? (
        <p className="text-2xs text-ink-muted">This choreo has no figures yet.</p>
      ) : (
        <List aria-label="Figures in this choreo" className="max-h-[60dvh] overflow-y-auto">
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
