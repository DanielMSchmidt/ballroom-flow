// T6 — the Journal tab (frames 3.1 / 3.2). A cross-routine list of lesson/practice
// entries (the UNION of routine-scoped annotations + account figureType notes),
// with kind/by-figure filter pills, author-coloured cards with link chips, a
// designed empty state, and the entry editor (+). Data flows through the store
// seam (loadJournal / createFamilyNote / createAnnotation) — never lib/rpc here.
import type { Anchor, AnnotationKind, RegistryKind } from "@weavesteps/domain";
import { isDanceId } from "@weavesteps/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";
import {
  applyJournalFilter,
  chipLabel,
  type JournalEntry,
  type JournalFilter,
  mergeLiveFamilyNotes,
  mergePendingEntries,
  relativeDate,
} from "../store/journal";
import { useAccount, useOwnFamilyNotes } from "../store/use-account";
import { useFirstVisitTour } from "../tour/useFirstVisitTour";
import { Button, Card, Chip, EmptyState, IconButton, Spinner } from "../ui";
import { JournalIcon, PlusIcon } from "../ui/icons";
import { JournalEntryEditor } from "./JournalEntryEditor";
import type { RoutineFigureOption, RoutineOption } from "./JournalLinkPicker";

export interface JournalProps {
  loadEntries: () => Promise<JournalEntry[]>;
  createFamilyEntry: (input: {
    figureType: string;
    danceScope: string;
    kind: AnnotationKind;
    text: string;
    count?: number;
    role?: "leader" | "follower";
  }) => Promise<void>;
  /** Saves a routine-anchored entry; resolves to the created entry (or null)
   *  so the list can show it before the D1 projection catches up (WEP-0002). */
  createRoutineEntry: (
    routineRef: string,
    input: { kind: AnnotationKind; text: string; anchors: Anchor[] },
  ) => Promise<JournalEntry | null>;
  loadRoutineOptions: () => Promise<RoutineOption[]>;
  loadRoutineFigures: (routineRef: string) => Promise<RoutineFigureOption[]>;
  /** The user's custom attribute kinds, for the link picker's attribute-family list. */
  loadCustomKinds?: () => Promise<RegistryKind[]>;
  /** The signed-in user's id, so their own entries read "you". */
  currentUserId?: string;
}

/** Filter pill VALUES (stable ids); display labels come from the journal catalog. */
const FILTERS: JournalFilter[] = ["all", "lessons", "practice", "byFigure"];

export function Journal(props: JournalProps): React.JSX.Element {
  const { loadEntries, currentUserId } = props;
  const t = useMessages(journalMessages);
  const filterLabels: Record<JournalFilter, string> = {
    all: t.filterAll,
    lessons: t.filterLessons,
    practice: t.filterPractice,
    byFigure: t.filterByFigure,
  };
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<JournalFilter>("all");
  const [composing, setComposing] = useState(false);
  const [customKinds, setCustomKinds] = useState<RegistryKind[]>([]);
  // First-visit tour — held while the entry editor covers the tab.
  useFirstVisitTour("journal", !composing);

  // Load the user's custom attribute kinds once the compose surface opens (for the
  // link picker's attribute-family list); builtin kinds always show regardless.
  const loadCustomKinds = props.loadCustomKinds;
  useEffect(() => {
    if (!composing || !loadCustomKinds) return;
    let live = true;
    loadCustomKinds().then(
      (k) => {
        if (live) setCustomKinds(k);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [composing, loadCustomKinds]);

  // docs/system/architecture.md (account docs, WEP-0002): the Journal is an
  // account-doc AUTHORING surface, so it opens the
  // account doc LAZILY here (D10) and authors figureType family notes through the
  // seam — a CRDT edit that persists offline + replays on reconnect + is undoable,
  // and that the alarm projects into the D1 index the journal list reads back. The
  // REST `createFamilyEntry` prop stays as the transitional fallback (the worker
  // keeps the route as a shim) for a signed-out/idle account store.
  const account = useAccount();
  const createFamilyEntry = useCallback(
    async (input: {
      figureType: string;
      danceScope: string;
      kind: AnnotationKind;
      text: string;
      count?: number;
      role?: "leader" | "follower";
    }) => {
      // The account store is open only for a signed-in user with a resolved id;
      // fall back to the REST prop otherwise (tests / signed-out compose).
      if (!account.isOpen) {
        await props.createFamilyEntry(input);
        return;
      }
      account.store.createFamilyNote({
        figureType: input.figureType,
        danceScope:
          input.danceScope === "all" || !isDanceId(input.danceScope) ? "all" : input.danceScope,
        kind: input.kind,
        text: input.text,
        ...(input.count != null ? { count: input.count } : {}),
        ...(input.role != null ? { role: input.role } : {}),
      });
    },
    [account, props],
  );

  // Attribute-predicate notes author through the account store only (offline-capable;
  // no REST write route exists or is needed — the seam replays on reconnect).
  const createPredicateEntry = useCallback(
    async (input: {
      attrKind: string;
      attrValue: string;
      role?: "leader" | "follower";
      scope: string;
      routineRef?: string;
      kind: AnnotationKind;
      text: string;
    }) => {
      if (!account.isOpen) return;
      const scope =
        input.scope === "all" || input.scope === "routine" || isDanceId(input.scope)
          ? input.scope
          : "all";
      account.store.createPredicateNote({
        attrKind: input.attrKind,
        attrValue: input.attrValue,
        scope,
        kind: input.kind,
        text: input.text,
        ...(input.role != null ? { role: input.role } : {}),
        ...(scope === "routine" && input.routineRef ? { routineRef: input.routineRef } : {}),
      });
    },
    [account],
  );

  const refresh = useCallback(() => {
    setError(false);
    setEntries(null);
    loadEntries().then(setEntries, () => setError(true));
  }, [loadEntries]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // WEP-0002 read-your-writes: the REST list reads D1 projections that trail a
  // just-saved entry (WS sync + DO alarm on both arms) — so the post-save
  // refresh would miss it. Merge (a) the live account-doc self-read for family
  // notes (reactive: a local edit re-renders instantly) and (b) the optimistic
  // echo of just-saved routine entries; both dedupe by id once the projection
  // catches up.
  const liveFamilyNotes = useOwnFamilyNotes(account.store);
  const [pendingRoutineEntries, setPendingRoutineEntries] = useState<JournalEntry[]>([]);
  const mergedEntries = useMemo(
    () =>
      entries === null
        ? null
        : mergePendingEntries(
            mergeLiveFamilyNotes(entries, liveFamilyNotes, currentUserId),
            pendingRoutineEntries,
          ),
    [entries, liveFamilyNotes, currentUserId, pendingRoutineEntries],
  );

  if (composing) {
    return (
      <JournalEntryEditor
        onBack={() => setComposing(false)}
        onSaved={() => {
          setComposing(false);
          refresh();
        }}
        createFamilyEntry={createFamilyEntry}
        createRoutineEntry={async (routineRef, input) => {
          const saved = await props.createRoutineEntry(routineRef, {
            ...input,
            anchors: input.anchors,
          });
          if (saved) setPendingRoutineEntries((p) => [saved, ...p]);
        }}
        createPredicateEntry={createPredicateEntry}
        loadRoutineOptions={props.loadRoutineOptions}
        loadRoutineFigures={props.loadRoutineFigures}
        customKinds={customKinds}
      />
    );
  }

  const visible = mergedEntries ? applyJournalFilter(mergedEntries, filter) : [];

  return (
    <section aria-label={t.journalTitle} className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-ink">{t.journalTitle}</h1>
        <IconButton
          label={t.newEntry}
          variant="filled"
          data-tour="journal-new"
          onClick={() => setComposing(true)}
        >
          <PlusIcon size={20} />
        </IconButton>
      </header>

      {mergedEntries !== null && mergedEntries.length > 0 && (
        <fieldset data-tour="journal-filters" className="flex flex-wrap items-center gap-1">
          <legend className="bf-sr-only">{t.filterJournal}</legend>
          {FILTERS.map((f) => (
            <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
              {filterLabels[f]}
            </Chip>
          ))}
        </fieldset>
      )}

      {mergedEntries === null && !error && <Spinner size={24} label={t.loadingJournal} />}

      {error && (
        <Card>
          <p className="text-2xs text-ink-secondary">{t.loadFailed}</p>
          <Button variant="secondary" size="sm" onClick={refresh}>
            {t.retry}
          </Button>
        </Card>
      )}

      {mergedEntries !== null && mergedEntries.length === 0 && (
        <EmptyState
          icon={<JournalIcon size={28} />}
          title={t.emptyTitle}
          description={t.emptyDescription}
          actions={
            <Button variant="primary" size="sm" onClick={() => setComposing(true)}>
              {t.emptyNewEntry}
            </Button>
          }
        />
      )}

      {mergedEntries !== null && mergedEntries.length > 0 && (
        <ul aria-label={t.journalEntries} className="flex flex-col gap-3">
          {visible.map((e) => (
            <li key={e.id}>
              <JournalCard entry={e} currentUserId={currentUserId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function JournalCard({
  entry,
  currentUserId,
}: {
  entry: JournalEntry;
  currentUserId?: string;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  const author =
    entry.authorId === currentUserId ? t.authorYou : (entry.displayName ?? t.authorSomeone);
  const tint = entry.identityColor ?? "var(--bf-border-strong)";
  return (
    <article
      className="rounded-lg border border-border-default bg-surface p-3 shadow-sm"
      style={{ borderLeftWidth: "4px", borderLeftColor: tint }}
    >
      <p className="flex flex-wrap items-center gap-1.5 text-2xs">
        <Chip tone="neutral" asStatic data-kind={entry.kind}>
          {entry.kind === "lesson" ? t.kindChipLesson : t.kindChipPractice}
        </Chip>
        <span className="font-bold" style={{ color: tint }}>
          {author}
        </span>
        <span className="text-ink-faint">· {relativeDate(entry.createdAt)}</span>
      </p>
      <p
        className="mt-1.5 text-ink"
        style={{ fontFamily: "var(--bf-font-note)", fontSize: "var(--bf-text-md)" }}
      >
        {entry.text}
      </p>
      {entry.anchors.filter((a) => a.type !== "figureType" || a.figureType !== "general").length >
        0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {entry.anchors
            .filter((a) => a.type !== "figureType" || a.figureType !== "general")
            .map((a) => (
              <span
                key={`${entry.id}-${a.type}-${chipLabel(a)}`}
                className="rounded-md bg-surface-sunken px-2 py-1 text-2xs text-studio-blue"
              >
                ↳ {chipLabel(a)}
              </span>
            ))}
        </div>
      )}
    </article>
  );
}
