// T6 — the cross-routine Journal read + pure list helpers, through the store seam.
//
// A journal entry is a lesson/practice annotation surfaced cross-routine: the
// UNION of routine-scoped annotations (projected to journal_entry by the routine
// DO alarm) and account-scoped figureType notes (figure_type_note_index). The
// worker owns visibility (the user + co-members on shared routines). Components
// reach this ONLY through the store — never lib/rpc directly (the §3 boundary).
import {
  type JournalEntry as ContractJournalEntry,
  figureTypeAnchorLabel,
} from "@weavesteps/contract";
import type { Anchor, AnnotationKind, Attribute, FigureDoc } from "@weavesteps/domain";
import { getLocale, pickMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";
import { apiGet } from "../lib/rpc";
import type { OwnFamilyNote } from "./account";
// NOTE: `openRoutineView` (→ routine.ts → @automerge/automerge) is imported
// DYNAMICALLY inside createRoutineJournalEntry, not statically — it is the only
// use of the Automerge store here, and a static import would pull the ~2.75 MB
// Automerge WASM into the initial chunk via the journal wiring on the app entry.
// Deferring it (alongside the lazy Assemble editor, ChoreoFlow.tsx) keeps Automerge
// off the first paint; it loads only when a routine journal entry is actually saved.

/** One journal entry as the worker returns it (anchors carry a resolved label). */
export type JournalEntry = ContractJournalEntry;
export type JournalAnchor = JournalEntry["anchors"][number];

/** Load the signed-in user's cross-routine journal (newest-first). */
export async function loadJournal(token: string | null, baseUrl = ""): Promise<JournalEntry[]> {
  const { entries } = await apiGet<{ entries: JournalEntry[] }>(`${baseUrl}/api/journal`, token);
  return entries;
}

/** The user's ANNOTATE-CAPABLE routines as link-picker options (docRef + title +
 *  dance). A routine-anchored entry is authored via createAnnotation, which the DO
 *  admits only for commenter+/editor/owner — so a VIEWER routine is filtered out
 *  here (else the optimistic write is silently dropped → phantom success). */
export async function loadRoutineOptions(
  token: string | null,
  baseUrl = "",
): Promise<{ docRef: string; title: string; dance: string }[]> {
  const { routines } = await apiGet<{
    routines: { docRef: string; title: string; dance: string; role: string }[];
  }>(`${baseUrl}/api/routines`, token);
  return routines
    .filter((r) => r.role !== "viewer")
    .map((r) => ({ docRef: r.docRef, title: r.title, dance: r.dance }));
}

/** A routine's placed figures as link-picker options (from its REST snapshot).
 *  Each carries its distinct sorted counts AND its live resolved attributes so
 *  the picker's placement grid renders the figure like the detail view does
 *  (docs/concepts/annotations.md § Anchors): a v5 VARIANT resolves against its live base (`resolveFigure`),
 *  exactly as the reading view renders it. */
export async function loadRoutineFigureOptions(
  routineId: string,
  token: string | null,
  baseUrl = "",
): Promise<
  {
    figureRef: string;
    name: string;
    figureType: string;
    counts: number[];
    attributes: Attribute[];
    hasFamily: boolean;
  }[]
> {
  const { routine, figures, bases } = await apiGet<{
    routine: {
      sections?: { placements?: { figureRef?: string; deletedAt?: number | null }[] }[];
    };
    // The snapshot serializes whole FigureDoc objects (worker index.ts) — plus
    // each variant's live base, keyed by ref.
    figures: Record<string, FigureDoc>;
    bases?: Record<string, FigureDoc>;
  }>(`${baseUrl}/api/routines/${encodeURIComponent(routineId)}/snapshot`, token);
  // resolveFigure lives in the domain package next to the Automerge machinery —
  // import it lazily so this module keeps Automerge off the app's first paint
  // (see the module-header NOTE; same pattern as createRoutineJournalEntry).
  const { resolveFigure, figureTypeHasCatalogFamily } = await import("@weavesteps/domain");
  const seen = new Set<string>();
  const out: {
    figureRef: string;
    name: string;
    figureType: string;
    counts: number[];
    attributes: Attribute[];
    hasFamily: boolean;
  }[] = [];
  for (const section of routine.sections ?? []) {
    for (const p of section.placements ?? []) {
      // A break placement carries no figureRef — skip it (US-004a).
      if (p.deletedAt != null || !p.figureRef || seen.has(p.figureRef)) continue;
      seen.add(p.figureRef);
      const fig = figures[p.figureRef];
      if (!fig) continue;
      const base = fig.baseFigureRef ? bases?.[fig.baseFigureRef] : undefined;
      const resolved = base ? resolveFigure(base, fig) : fig;
      const attributes = resolved.attributes.filter((a) => a.deletedAt == null);
      const counts = [...new Set(attributes.map((a) => a.count))].sort((a, b) => a - b);
      out.push({
        figureRef: p.figureRef,
        name: resolved.name,
        figureType: resolved.figureType,
        counts,
        attributes,
        // A custom (from-scratch) figure carries a slugged figureType that names
        // no catalog family — a family note has nothing to pin to. The picker
        // gates its family-scope options on this so the note falls through to a
        // this-choreo annotation (never invents a private one-figure "family").
        hasFamily: figureTypeHasCatalogFamily(resolved.figureType),
      });
    }
  }
  return out;
}

/** Map a domain anchor onto the journal wire shape (no `label` — the client
 *  chip falls back; the server projection resolves labels on its own read). */
function toJournalAnchor(a: Anchor): JournalAnchor {
  if (a.type === "point") {
    return {
      type: "point",
      figureRef: a.figureRef,
      count: a.count,
      ...(a.role ? { role: a.role } : {}),
    };
  }
  if (a.type === "figure") return { type: "figure", figureRef: a.figureRef };
  return {
    type: "figureType",
    figureType: a.figureType,
    danceScope: a.danceScope,
    ...(a.count != null ? { count: a.count } : {}),
    ...(a.role != null ? { role: a.role } : {}),
  };
}

/**
 * Author a ROUTINE-scoped journal entry (LOCKED full-parity #1): open the routine's
 * editable store and createAnnotation with the built anchor(s). Resolves once the
 * annotation is applied locally (so it has been sent over the routine WS); the DO
 * persists it and projects it to journal_entry on its next (coalesced) alarm.
 *
 * Returns the created entry (WEP-0002 read-your-writes symmetry): the D1
 * `journal_entry` projection trails the save by a WS round-trip + alarm tick,
 * so the Journal list's post-save refresh can miss the entry — the caller
 * merges this optimistic echo until the projection catches up (dedupe by id).
 */
export async function createRoutineJournalEntry(
  routineRef: string,
  input: { kind: AnnotationKind; text: string; anchors: Anchor[] },
  opts: {
    getToken: () => Promise<string | null>;
    currentUserId?: string;
    baseUrl?: string;
    timeoutMs?: number;
  },
): Promise<JournalEntry | null> {
  const { openRoutineView } = await import("./routine-view");
  const store = openRoutineView(routineRef, {
    editable: true,
    getToken: opts.getToken,
    currentUserId: opts.currentUserId,
    baseUrl: opts.baseUrl,
    hydrationTimeoutMs: 12_000,
  });
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let created: { id: string; authorId: string; createdAt: number } | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let requested = false;
      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error("routine entry save timed out")), timeoutMs);
      const tryProgress = (): void => {
        if (store.syncState() !== "live") return;
        if (!requested) {
          requested = true;
          store.createAnnotation(input);
        }
        const match = store
          .readAnnotations()
          .find((a) => a.text === input.text && a.kind === input.kind && a.deletedAt == null);
        if (match) {
          created = { id: match.id, authorId: match.authorId, createdAt: match.createdAt };
          finish();
        }
      };
      const unsub = store.subscribe(tryProgress);
      tryProgress();
    });
    // Let the WS frame flush to the DO before we tear the socket down.
    await new Promise((r) => setTimeout(r, 250));
  } finally {
    store.close();
  }
  // The journal read is lesson/practice only — a plain note never surfaces there.
  if (created === null || (input.kind !== "lesson" && input.kind !== "practice")) return null;
  const echo: { id: string; authorId: string; createdAt: number } = created;
  return {
    id: echo.id,
    routineRef,
    authorId: echo.authorId,
    kind: input.kind,
    text: input.text,
    anchors: input.anchors.map(toJournalAnchor),
    createdAt: echo.createdAt,
    displayName: null,
    identityColor: null,
    source: "routine",
  };
}

/**
 * Merge just-saved (optimistic-echo) entries over the REST list: an entry the
 * projection has already caught up on is deduped by id (the REST row wins — it
 * carries the joined author display fields); the rest surface immediately.
 */
export function mergePendingEntries(
  entries: JournalEntry[],
  pending: JournalEntry[],
): JournalEntry[] {
  if (pending.length === 0) return entries;
  const seen = new Set(entries.map((e) => e.id));
  const merged = [...entries, ...pending.filter((p) => !seen.has(p.id))];
  merged.sort((a, b) => b.createdAt - a.createdAt);
  return merged;
}

/**
 * WEP-0002 read-your-writes: merge the user's OWN family notes read LIVE from
 * the open account doc into the REST journal list. The REST account arm reads
 * the `figure_type_note_index` D1 projection, which the account DO's alarm
 * writes only AFTER the local CRDT edit has synced over the WebSocket — so a
 * just-authored family entry is reliably missing from a fetch that follows the
 * save (the note is only local, or the alarm hasn't ticked). The live self-read
 * is the source of truth for own notes; entries the projection has already
 * caught up on are deduped by id (the REST row wins — it carries the joined
 * author display fields). Journal = lesson/practice only, matching the read.
 */
export function mergeLiveFamilyNotes(
  entries: JournalEntry[],
  liveNotes: OwnFamilyNote[],
  currentUserId: string | undefined,
): JournalEntry[] {
  if (!currentUserId || liveNotes.length === 0) return entries;
  const seen = new Set(entries.map((e) => e.id));
  const merged = [...entries];
  for (const n of liveNotes) {
    if (seen.has(n.id)) continue;
    if (n.kind !== "lesson" && n.kind !== "practice") continue;
    merged.push({
      id: n.id,
      routineRef: `account:${currentUserId}`,
      authorId: currentUserId,
      kind: n.kind,
      text: n.text,
      anchors: [
        {
          type: "figureType",
          figureType: n.figureType,
          danceScope: n.danceScope,
          ...(n.count != null ? { count: n.count } : {}),
          ...(n.role != null ? { role: n.role } : {}),
          label: figureTypeAnchorLabel(n.figureType, n.danceScope, n.count),
        },
      ],
      createdAt: n.createdAt,
      displayName: null,
      identityColor: null,
      source: "account",
    });
  }
  merged.sort((a, b) => b.createdAt - a.createdAt);
  return merged;
}

export type JournalFilter = "all" | "lessons" | "practice" | "byFigure";

/** Is this anchor a figure-bearing one (point/figure/figureType)? */
function figureAnchorOf(entry: JournalEntry): JournalAnchor | undefined {
  return entry.anchors.find(
    (a) => a.type === "point" || a.type === "figure" || a.type === "figureType",
  );
}

/** The figure/family sort key for the by-figure grouping (anchorless → undefined). */
function figureSortKey(entry: JournalEntry): string | undefined {
  const a = figureAnchorOf(entry);
  if (!a) return undefined;
  if (a.type === "figureType") return a.figureType ?? a.label;
  return a.label ?? a.figureRef;
}

/**
 * Apply a filter pill to the list. `all` is identity (already newest-first);
 * `lessons`/`practice` keep that kind; `byFigure` groups/sorts by the first
 * figure/figureType anchor's name, entries with NO figure anchor sorting LAST.
 */
export function applyJournalFilter(entries: JournalEntry[], filter: JournalFilter): JournalEntry[] {
  if (filter === "lessons") return entries.filter((e) => e.kind === "lesson");
  if (filter === "practice") return entries.filter((e) => e.kind === "practice");
  if (filter === "byFigure") {
    return [...entries].sort((a, b) => {
      const ka = figureSortKey(a);
      const kb = figureSortKey(b);
      if (ka === undefined && kb === undefined) return b.createdAt - a.createdAt;
      if (ka === undefined) return 1; // anchorless sorts last
      if (kb === undefined) return -1;
      return ka.localeCompare(kb);
    });
  }
  return entries;
}

/** The display label for a link chip (the server pre-resolves `label`; fallback
 *  otherwise). A TIMED figureType anchor (docs/concepts/annotations.md § Anchors) appends its pinned count. */
export function chipLabel(anchor: JournalAnchor): string {
  const t = pickMessages(journalMessages);
  if (anchor.label) return anchor.label;
  if (anchor.type === "point") return t.stepChip((anchor.count ?? 0) + 1);
  if (anchor.type === "figure") return anchor.figureRef ?? t.thisFigureChip;
  const family = anchor.figureType ?? t.figureChip;
  return anchor.count != null ? `${family} · ${t.onCount(String(anchor.count))}` : family;
}

/**
 * A short relative date for a card ("today" / "Mon" / "3 May"). `now` is
 * injectable for deterministic tests.
 */
export function relativeDate(createdAt: number, now: number = Date.now()): string {
  const t = pickMessages(journalMessages);
  const dateLocale = getLocale() === "de" ? "de-DE" : "en-US";
  const day = 24 * 60 * 60 * 1000;
  const startOf = (ts: number): number => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diffDays = Math.round((startOf(now) - startOf(createdAt)) / day);
  if (diffDays <= 0) return t.today;
  if (diffDays === 1) return t.yesterday;
  if (diffDays < 7) {
    return new Date(createdAt).toLocaleDateString(dateLocale, { weekday: "short" });
  }
  return new Date(createdAt).toLocaleDateString(dateLocale, { day: "numeric", month: "short" });
}

// (The catalog-family picker path — `figureFamilies()` — was removed
// (docs/concepts/annotations.md § The Journal): every journal link now starts
// from one of the user's choreos.)
