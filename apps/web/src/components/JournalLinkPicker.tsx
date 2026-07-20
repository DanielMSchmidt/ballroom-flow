// docs/concepts/annotations.md § Anchors / § The Journal (WEP-0004) — the
// Journal link picker, rebuilt CHOREO-FIRST. One linear
// bottom-sheet flow: pick a choreo → pick a figure FROM that choreo (type-ahead
// filter) → place the note via the figure's attribute grid (entire figure, or
// one count, with a Both/Leader/Follower role lens) → choose the sharing scope
// LAST. Scope options are gated by the placement: a whole-figure note may span
// every dance the family exists in; a TIMED (count) note scopes to this dance
// or this choreo only — never across dances (counts don't align: a Waltz
// Whisk's 1-2-3 vs its Quickstep sibling's S-Q-Q).
//
// The produced JournalLink decides the save path in the entry editor:
// routine → createAnnotation on `routineRef` (figure/point anchor); account →
// createFamilyNote (figureType anchor, optionally timed). Data arrives via
// injected loaders (the store seam); the component holds no I/O of its own.
import {
  type Anchor,
  ATTRIBUTE_REGISTRY,
  type Attribute,
  countLabel,
  type DanceId,
  isDanceId,
  kindAppliesToDance,
  mergeRegistry,
  PREDICATE_NONE,
  type RegistryKind,
  type Role,
} from "@weavesteps/domain";
import { useEffect, useState } from "react";
import { danceName, type Locale, useLocale, useMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";
import { AttrChip, Button, Input, List, ListRow, SegmentedToggle, Sheet, Spinner } from "../ui";
import { displayValue } from "./role-view";

/** One of the user's routines (the choreo chooser). */
export interface RoutineOption {
  docRef: string;
  title: string;
  dance: string;
}
/** A figure placed in a routine, resolved from its snapshot (a variant resolves
 *  against its live base) — distinct sorted counts + the live attributes the
 *  placement grid renders. */
export interface RoutineFigureOption {
  figureRef: string;
  name: string;
  figureType: string;
  counts: number[];
  attributes: Attribute[];
  /** Whether this figure's `figureType` names a real catalog family. A custom
   *  (from-scratch) figure has none, so the scope step hides the family options
   *  (`figureType` notes) and only offers "this choreo" — the note falls through
   *  to a routine annotation (there is no family to add it to). */
  hasFamily: boolean;
}

/**
 * A built link the editor stores. `home` decides the save path:
 * routine → createAnnotation on `routineRef`; account → createFamilyNote
 * (docs/concepts/annotations.md § Anchors, WEP-0004: optionally TIMED —
 * count/role ride along, never with "all").
 */
export type JournalLink =
  | { home: "routine"; routineRef: string; routineTitle: string; anchor: Anchor; label: string }
  | {
      home: "account";
      figureType: string;
      danceScope: string;
      count?: number;
      role?: "leader" | "follower";
      anchor: Anchor;
      label: string;
    }
  | {
      // attribute-predicate link (docs/concepts/annotations.md § Anchors): a dynamic
      // predicate over notation, saved through the account store's createPredicateNote.
      home: "accountPredicate";
      attrKind: string;
      attrValue: string;
      role?: "leader" | "follower";
      scope: string;
      routineRef?: string;
      anchor: Anchor;
      label: string;
    };

export interface JournalLinkPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (link: JournalLink) => void;
  /** The user's routines (for the choreo chooser). */
  loadRoutineOptions: () => Promise<RoutineOption[]>;
  /** A routine's figures (for the figure-in-choreo chooser + placement grid). */
  loadRoutineFigures: (routineRef: string) => Promise<RoutineFigureOption[]>;
  /** The user's custom attribute kinds, merged into the registry for the attribute
   *  family list (Tango still omits `rise` via the dance gate). Defaults to none. */
  customKinds?: RegistryKind[];
  /** Context-first capture (docs/concepts/annotations.md § scope-first note flow):
   *  the dance the note was scoped to. Pre-filters the choreo chooser to that
   *  dance's choreos. Absent → all the user's choreos (the old behavior). */
  scopeDance?: DanceId;
  /** A choreo already chosen in the scope step — the picker opens straight on the
   *  target step for it (no re-picking the dance/choreo). Absent → open on the
   *  (dance-filtered) choreo list. */
  scopeRoutine?: RoutineOption;
}

type Step =
  | "choreo"
  | "target"
  | "figure"
  | "place"
  | "scope"
  | "attrFamily"
  | "attrValue"
  | "attrRole"
  | "attrScope";
/** WHERE on the figure the note lands (the place step's outcome). */
type Placement = { kind: "whole" } | { kind: "count"; count: number };
/** The place step's role lens; "both" = no role stored (the null convention). */
type RoleLens = "both" | "leader" | "follower";

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
  return isDanceId(dance) ? danceName(dance, locale) : titleCase(dance);
}

export function JournalLinkPicker({
  open,
  onClose,
  onPick,
  loadRoutineOptions,
  loadRoutineFigures,
  customKinds,
  scopeDance,
  scopeRoutine,
}: JournalLinkPickerProps): React.JSX.Element | null {
  const t = useMessages(journalMessages);
  const locale = useLocale();
  const [step, setStep] = useState<Step>("choreo");
  const [routine, setRoutine] = useState<RoutineOption | null>(null);
  const [figure, setFigure] = useState<RoutineFigureOption | null>(null);
  const [placement, setPlacement] = useState<Placement>({ kind: "whole" });
  const [roleLens, setRoleLens] = useState<RoleLens>("both");
  // Attribute-predicate path state.
  const [attrKind, setAttrKind] = useState<RegistryKind | null>(null);
  const [attrValue, setAttrValue] = useState<string | null>(null);

  // Reset whenever the sheet (re)opens. Context-first capture: a pre-chosen scope
  // routine opens straight on the target step (no re-picking the choreo);
  // otherwise open on the (dance-filtered) choreo list.
  useEffect(() => {
    if (open) {
      setRoutine(scopeRoutine ?? null);
      setStep(scopeRoutine ? "target" : "choreo");
      setFigure(null);
      setPlacement({ kind: "whole" });
      setRoleLens("both");
      setAttrKind(null);
      setAttrValue(null);
    }
  }, [open, scopeRoutine]);

  if (!open) return null;

  const familyLabel = attrKind?.label ?? "";
  const titles: Record<Step, string> = {
    choreo: t.titleChoreo,
    target: t.titleTarget,
    figure: routine ? t.titleFigureIn(routine.title || t.untitled) : t.titleChoreo,
    place: figure ? t.titleGrain(figure.name) : t.titleGrainFallback,
    scope: t.titleScope,
    attrFamily: t.titleAttrFamily,
    attrValue: t.titleAttrValue(familyLabel),
    attrRole: t.titleAttrRole,
    attrScope: t.titleScope,
  };

  const back = (): void => {
    // With a pre-chosen scope routine the choreo step is skipped — back from the
    // target step closes the sheet (returns to the editor) rather than exposing a
    // choreo re-pick the scope already made.
    if (step === "target") (scopeRoutine ? onClose : () => setStep("choreo"))();
    else if (step === "figure") setStep("target");
    else if (step === "place") setStep("figure");
    else if (step === "scope") setStep("place");
    else if (step === "attrFamily") setStep("target");
    else if (step === "attrValue") setStep("attrFamily");
    else if (step === "attrRole") setStep("attrValue");
    else if (step === "attrScope") setStep("attrRole");
  };

  /** The stored role for the current lens (Both → absent, the null convention). */
  const lensRole = (): Role | undefined => (roleLens === "both" ? undefined : roleLens);

  /** The " · Leader" chip suffix for a role-narrowed link. */
  const roleSuffix = (): string => {
    if (roleLens === "both") return "";
    return t.roleChipSuffix(roleLens === "leader" ? t.roleLeader : t.roleFollower);
  };

  /** Finalize the link once the scope is chosen (the flow's last step). */
  const finalize = (scope: "choreo" | "dance" | "all"): void => {
    if (!routine || !figure) return;
    const role = lensRole();
    const timed = placement.kind === "count";
    if (scope === "choreo") {
      const anchor: Anchor =
        placement.kind === "whole"
          ? { type: "figure", figureRef: figure.figureRef }
          : {
              type: "point",
              figureRef: figure.figureRef,
              count: placement.count,
              ...(role ? { role } : {}),
            };
      const label =
        placement.kind === "whole"
          ? t.wholeFigureChip(figure.name)
          : `${t.countChip(figure.name, countLabel(placement.count))}${roleSuffix()}`;
      onPick({
        home: "routine",
        routineRef: routine.docRef,
        routineTitle: routine.title,
        anchor,
        label,
      });
    } else {
      // Account (figureType) link. The "dance" scope keeps the routine's dance;
      // a timed anchor never carries "all" (the scope row isn't offered, and
      // zAnchor/zFamilyNoteBody reject it anyway).
      const danceScope = scope === "all" ? "all" : routine.dance;
      const anchorScope = isDanceId(danceScope) || danceScope === "all" ? danceScope : "all";
      const family = t.allOfType(titleCase(figure.figureType));
      const scopeLabel =
        scope === "all" ? t.allDances : t.scopeAllDance(danceLabel(routine.dance, locale));
      const timing =
        placement.kind === "count" ? ` · ${t.onCount(countLabel(placement.count))}` : "";
      onPick({
        home: "account",
        figureType: figure.figureType,
        danceScope,
        ...(placement.kind === "count" ? { count: placement.count } : {}),
        ...(timed && role ? { role } : {}),
        anchor: {
          type: "figureType",
          figureType: figure.figureType,
          danceScope: anchorScope,
          ...(placement.kind === "count" ? { count: placement.count } : {}),
          ...(timed && role ? { role } : {}),
        },
        label: `${family} · ${scopeLabel}${timing}${timed ? roleSuffix() : ""}`,
      });
    }
    onClose();
  };

  /** Finalize an attribute-predicate link once the attribute scope is chosen. */
  const finalizePredicate = (scope: "dance" | "all" | "routine"): void => {
    if (!routine || !attrKind || attrValue == null) return;
    const role = lensRole();
    // The anchor scope is a DanceId | "all" | "routine". A dance scope narrows
    // routine.dance through isDanceId (a legacy/garbage dance falls back to "all").
    const anchorScope: DanceId | "all" | "routine" =
      scope === "all"
        ? "all"
        : scope === "routine"
          ? "routine"
          : isDanceId(routine.dance)
            ? routine.dance
            : "all";
    const value = displayValue(attrValue);
    const scopeText =
      scope === "all"
        ? t.attrScopeEveryDance
        : scope === "routine"
          ? routine.title || t.untitled
          : danceLabel(routine.dance, locale);
    const label =
      attrValue === PREDICATE_NONE
        ? t.predicateNoneChip(attrKind.label, scopeText)
        : t.predicateChip(value, scopeText);
    onPick({
      home: "accountPredicate",
      attrKind: attrKind.kind,
      attrValue,
      scope: anchorScope,
      ...(role ? { role } : {}),
      ...(scope === "routine" ? { routineRef: routine.docRef } : {}),
      anchor: {
        type: "attributePredicate",
        kind: attrKind.kind,
        value: attrValue,
        scope: anchorScope,
        ...(role ? { role } : {}),
        ...(scope === "routine" ? { routineRef: routine.docRef } : {}),
      },
      label,
    });
    onClose();
  };

  const timed = placement.kind === "count";
  // The dance-wide scope is only offered when the routine's dance is a real
  // DanceId (a legacy/garbage dance could never match the worker's enum).
  const danceScopeAvailable = routine ? isDanceId(routine.dance) : false;
  // The merged registry, gated to the routine's dance (Tango omits `rise`).
  const attrFamilies: RegistryKind[] = routine
    ? Object.values(mergeRegistry(ATTRIBUTE_REGISTRY, customKinds ?? [])).filter((k) =>
        kindAppliesToDance(k.kind, isDanceId(routine.dance) ? routine.dance : undefined),
      )
    : [];

  return (
    <Sheet open={open} onClose={onClose} title={titles[step]}>
      {step === "choreo" && (
        <RoutineChooser
          loadRoutineOptions={loadRoutineOptions}
          scopeDance={scopeDance}
          onPick={(r) => {
            setRoutine(r);
            setStep("target");
          }}
        />
      )}

      {step === "target" && routine && (
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" onClick={back}>
            {t.backShort}
          </Button>
          <List aria-label={t.linkTargets}>
            <ListRow
              title={t.targetFigure}
              subtitle={t.targetFigureHint}
              onClick={() => setStep("figure")}
            />
            <ListRow
              title={t.targetAttribute}
              subtitle={t.targetAttributeHint}
              onClick={() => setStep("attrFamily")}
            />
          </List>
        </div>
      )}

      {step === "attrFamily" && routine && (
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" onClick={back}>
            {t.backShort}
          </Button>
          <List aria-label={t.attrFamilies} className="max-h-[60dvh] overflow-y-auto">
            {attrFamilies.map((k) => (
              <ListRow
                key={k.kind}
                title={k.label}
                onClick={() => {
                  setAttrKind(k);
                  setAttrValue(null);
                  setRoleLens("both");
                  setStep("attrValue");
                }}
              />
            ))}
          </List>
        </div>
      )}

      {step === "attrValue" && attrKind && (
        <AttrValueChooser
          kind={attrKind}
          onBack={back}
          onPick={(v) => {
            setAttrValue(v);
            setStep("attrRole");
          }}
        />
      )}

      {step === "attrRole" && attrKind && (
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" onClick={back}>
            {t.backShort}
          </Button>
          <SegmentedToggle
            ariaLabel={t.stepsFor}
            options={[
              { value: "both", label: t.roleBoth },
              { value: "leader", label: t.roleLeader },
              { value: "follower", label: t.roleFollower },
            ]}
            value={roleLens}
            onChange={setRoleLens}
          />
          <Button variant="primary" size="sm" onClick={() => setStep("attrScope")}>
            {t.done}
          </Button>
        </div>
      )}

      {step === "attrScope" && routine && (
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" onClick={back}>
            {t.backShort}
          </Button>
          <List aria-label={t.linkScope}>
            {danceScopeAvailable && (
              <ListRow
                title={t.attrScopeAllDance(danceLabel(routine.dance, locale))}
                subtitle={t.attrScopeAllDanceHint}
                onClick={() => finalizePredicate("dance")}
              />
            )}
            <ListRow
              title={t.attrScopeEveryDance}
              subtitle={t.attrScopeEveryDanceHint}
              onClick={() => finalizePredicate("all")}
            />
            <ListRow
              title={t.attrScopeThisChoreo}
              subtitle={t.attrScopeThisChoreoHint(routine.title || t.untitled)}
              onClick={() => finalizePredicate("routine")}
            />
          </List>
        </div>
      )}

      {step === "figure" && routine && (
        <FigureInRoutineChooser
          routineRef={routine.docRef}
          loadRoutineFigures={loadRoutineFigures}
          onBack={back}
          onPick={(f) => {
            setFigure(f);
            setPlacement({ kind: "whole" });
            setRoleLens("both");
            setStep("place");
          }}
        />
      )}

      {step === "place" && figure && (
        <PlacementGrid
          figure={figure}
          roleLens={roleLens}
          onRoleLens={setRoleLens}
          onBack={back}
          onPick={(p) => {
            setPlacement(p);
            setStep("scope");
          }}
        />
      )}

      {step === "scope" && routine && figure && (
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" onClick={back}>
            {t.backShort}
          </Button>
          <List aria-label={t.linkScope}>
            {/* Family (figureType) scopes only exist when the figure belongs to a
                real catalog family. A custom figure has none — nothing to add a
                family note to — so both rows drop and the note falls through to
                "this choreo only" (a routine annotation). */}
            {figure.hasFamily && danceScopeAvailable && (
              <ListRow
                title={t.allDanceChoreos(danceLabel(routine.dance, locale))}
                subtitle={t.allDanceChoreosHint}
                onClick={() => finalize("dance")}
              />
            )}
            {/* A timed note never spans dances — the row simply isn't offered. */}
            {figure.hasFamily && !timed && (
              <ListRow
                title={t.everyDance}
                subtitle={t.everyDanceHint}
                onClick={() => finalize("all")}
              />
            )}
            <ListRow
              title={t.thisChoreoOnly}
              subtitle={t.thisChoreoOnlyHint(routine.title || t.untitled)}
              onClick={() => finalize("choreo")}
            />
          </List>
        </div>
      )}
    </Sheet>
  );
}

function RoutineChooser({
  loadRoutineOptions,
  scopeDance,
  onPick,
}: {
  loadRoutineOptions: () => Promise<RoutineOption[]>;
  /** Context-first capture: pre-filter the list to this dance's choreos. */
  scopeDance?: DanceId;
  onPick: (r: RoutineOption) => void;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  const locale = useLocale();
  const [routines, setRoutines] = useState<RoutineOption[] | null>(null);
  useEffect(() => {
    let live = true;
    loadRoutineOptions().then((r) => {
      if (live) setRoutines(scopeDance ? r.filter((o) => o.dance === scopeDance) : r);
    });
    return () => {
      live = false;
    };
  }, [loadRoutineOptions, scopeDance]);

  return (
    <div className="flex flex-col gap-2">
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
  loadRoutineFigures,
  onBack,
  onPick,
}: {
  routineRef: string;
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

  const q = query.trim().toLowerCase();
  const list = figures
    ? q
      ? figures.filter((f) => f.name.toLowerCase().includes(q))
      : figures
    : null;

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

/**
 * The attribute-value step (docs/concepts/annotations.md § Anchors, v4 § 3.6): the kind's
 * enumerated values as tappable rows, an explicit "No value logged" row (the PREDICATE_NONE
 * absence sentinel), plus a free-text input for a `freeText` kind. Picking a value advances
 * to the role step.
 */
function AttrValueChooser({
  kind,
  onBack,
  onPick,
}: {
  kind: RegistryKind;
  onBack: () => void;
  onPick: (value: string) => void;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  const [custom, setCustom] = useState("");
  const values = kind.values ?? [];
  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        {t.backShort}
      </Button>
      <List aria-label={t.attrValues} className="max-h-[55dvh] overflow-y-auto">
        {values.map((v) => (
          <ListRow key={v} title={displayValue(v)} onClick={() => onPick(v)} />
        ))}
        <ListRow
          title={t.attrValueNone}
          subtitle={t.attrValueNoneHint(kind.label)}
          onClick={() => onPick(PREDICATE_NONE)}
        />
      </List>
      {kind.freeText && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = custom.trim();
            if (v) onPick(v);
          }}
        >
          <Input
            label={t.attrValues}
            hideLabel
            placeholder={displayValue(kind.label)}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <Button variant="primary" size="sm" type="submit" disabled={!custom.trim()}>
            {t.done}
          </Button>
        </form>
      )}
    </div>
  );
}

/**
 * The place step (docs/concepts/annotations.md § Anchors, WEP-0004): a
 * read-only rendering of the figure's attribute
 * grid, mirroring the detail view — one row per count with that count's value
 * chips (kind-tinted, role-lens filtered) — plus an "entire figure" row on top
 * and a Both/Leader/Follower lens. Tapping a row picks that count.
 */
function PlacementGrid({
  figure,
  roleLens,
  onRoleLens,
  onBack,
  onPick,
}: {
  figure: RoutineFigureOption;
  roleLens: RoleLens;
  onRoleLens: (lens: RoleLens) => void;
  onBack: () => void;
  onPick: (p: Placement) => void;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  // Rows stay stable across lenses (every count of the figure); the LENS only
  // filters which chips render — both-role (null) values always show.
  const visible =
    roleLens === "both"
      ? figure.attributes
      : figure.attributes.filter((a) => a.role == null || a.role === roleLens);

  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        {t.backShort}
      </Button>
      <SegmentedToggle
        ariaLabel={t.stepsFor}
        options={[
          { value: "both", label: t.roleBoth },
          { value: "leader", label: t.roleLeader },
          { value: "follower", label: t.roleFollower },
        ]}
        value={roleLens}
        onChange={onRoleLens}
      />
      <List aria-label={t.figureGrainList} className="max-h-[55dvh] overflow-y-auto">
        <ListRow
          title={t.entireFigure}
          subtitle={t.entireFigureHint}
          onClick={() => onPick({ kind: "whole" })}
        />
        {figure.counts.map((count) => {
          const here = visible.filter((a) => a.count === count);
          const values = here.map((a) => displayValue(a.value)).join(", ");
          return (
            <button
              key={count}
              type="button"
              aria-label={t.countRowLabel(countLabel(count), values)}
              onClick={() => onPick({ kind: "count", count })}
              className="flex min-h-[var(--bf-touch-target)] w-full items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 text-left shadow-sm"
            >
              <span className="w-7 flex-none text-center text-sm font-bold text-ink">
                {countLabel(count)}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                {here.map((a) => (
                  <AttrChip key={a.id} kind={a.kind} label={displayValue(a.value)} />
                ))}
              </span>
              <span aria-hidden="true" className="text-ink-faint">
                ›
              </span>
            </button>
          );
        })}
      </List>
    </div>
  );
}
