// T6 — the Journal tab (frames 3.1 / 3.2). A cross-routine list of lesson/practice
// entries (the UNION of routine-scoped annotations + account figureType notes),
// with kind/by-figure filter pills, author-coloured cards with link chips, a
// designed empty state, and the entry editor (+). Data flows through the store
// seam (loadJournal / createFamilyNote / createAnnotation) — never lib/rpc here.
import type { AnnotationKind } from "@ballroom/domain";
import { useCallback, useEffect, useState } from "react";
import {
  applyJournalFilter,
  chipLabel,
  type JournalEntry,
  type JournalFilter,
  relativeDate,
} from "../store/journal";
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
  }) => Promise<void>;
  createRoutineEntry: (
    routineRef: string,
    input: { kind: AnnotationKind; text: string; anchors: unknown[] },
  ) => Promise<void>;
  loadRoutineOptions: () => Promise<RoutineOption[]>;
  loadRoutineFigures: (routineRef: string) => Promise<RoutineFigureOption[]>;
  /** The signed-in user's id, so their own entries read "you". */
  currentUserId?: string;
}

const FILTERS: { value: JournalFilter; label: string }[] = [
  { value: "all", label: "all" },
  { value: "lessons", label: "lessons" },
  { value: "practice", label: "practice" },
  { value: "byFigure", label: "by figure" },
];

export function Journal(props: JournalProps): React.JSX.Element {
  const { loadEntries, currentUserId } = props;
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<JournalFilter>("all");
  const [composing, setComposing] = useState(false);

  const refresh = useCallback(() => {
    setError(false);
    setEntries(null);
    loadEntries().then(setEntries, () => setError(true));
  }, [loadEntries]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (composing) {
    return (
      <JournalEntryEditor
        onBack={() => setComposing(false)}
        onSaved={() => {
          setComposing(false);
          refresh();
        }}
        createFamilyEntry={props.createFamilyEntry}
        createRoutineEntry={(routineRef, input) =>
          props.createRoutineEntry(routineRef, { ...input, anchors: input.anchors })
        }
        loadRoutineOptions={props.loadRoutineOptions}
        loadRoutineFigures={props.loadRoutineFigures}
      />
    );
  }

  const visible = entries ? applyJournalFilter(entries, filter) : [];

  return (
    <section aria-label="Journal" className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-ink">Journal</h1>
        <IconButton label="New entry" variant="filled" onClick={() => setComposing(true)}>
          <PlusIcon size={20} />
        </IconButton>
      </header>

      {entries !== null && entries.length > 0 && (
        <fieldset className="flex flex-wrap items-center gap-1">
          <legend className="bf-sr-only">Filter journal</legend>
          {FILTERS.map((f) => (
            <Chip key={f.value} selected={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
            </Chip>
          ))}
        </fieldset>
      )}

      {entries === null && !error && <Spinner size={24} label="Loading journal" />}

      {error && (
        <Card>
          <p className="text-2xs text-ink-secondary">Couldn't load your journal.</p>
          <Button variant="secondary" size="sm" onClick={refresh}>
            Retry
          </Button>
        </Card>
      )}

      {entries !== null && entries.length === 0 && (
        <EmptyState
          icon={<JournalIcon size={28} />}
          title="No entries yet"
          description="Log a lesson or a practice session — link it to the figures & attributes you worked on."
          actions={
            <Button variant="primary" size="sm" onClick={() => setComposing(true)}>
              + New entry
            </Button>
          }
        />
      )}

      {entries !== null && entries.length > 0 && (
        <ul aria-label="journal entries" className="flex flex-col gap-3">
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
  const author = entry.authorId === currentUserId ? "you" : (entry.displayName ?? "someone");
  const tint = entry.identityColor ?? "var(--bf-border-strong)";
  return (
    <article
      className="rounded-lg border border-border-default bg-surface p-3 shadow-sm"
      style={{ borderLeftWidth: "4px", borderLeftColor: tint }}
    >
      <p className="flex flex-wrap items-center gap-1.5 text-2xs">
        <Chip tone="neutral" asStatic data-kind={entry.kind}>
          {entry.kind === "lesson" ? "LESSON" : "PRACTICE"}
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
      {entry.anchors.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {entry.anchors.map((a) => (
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
