// T6 — the cross-routine Journal read + pure list helpers, through the store seam.
//
// A journal entry is a lesson/practice annotation surfaced cross-routine: the
// UNION of routine-scoped annotations (projected to journal_entry by the routine
// DO alarm) and account-scoped figureType notes (figure_type_note_index). The
// worker owns visibility (the user + co-members on shared routines). Components
// reach this ONLY through the store — never lib/rpc directly (the §3 boundary).
import type { JournalEntry as ContractJournalEntry } from "@weavesteps/contract";
import type { Anchor, AnnotationKind } from "@weavesteps/domain";
import { LIBRARY_FIGURES } from "@weavesteps/domain";
import { getLocale, pickMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";
import { apiGet } from "../lib/rpc";
import { openRoutineView } from "./routine-view";

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
 *  Each carries its distinct sorted counts so the picker can offer an
 *  "On count N" grain (T6 / US-004a). */
export async function loadRoutineFigureOptions(
  routineId: string,
  token: string | null,
  baseUrl = "",
): Promise<{ figureRef: string; name: string; figureType: string; counts: number[] }[]> {
  const { routine, figures } = await apiGet<{
    routine: {
      sections?: { placements?: { figureRef?: string; deletedAt?: number | null }[] }[];
    };
    figures: Record<
      string,
      {
        name: string;
        figureType: string;
        attributes?: { count: number; deletedAt?: number | null }[];
      }
    >;
  }>(`${baseUrl}/api/routines/${encodeURIComponent(routineId)}/snapshot`, token);
  const seen = new Set<string>();
  const out: { figureRef: string; name: string; figureType: string; counts: number[] }[] = [];
  for (const section of routine.sections ?? []) {
    for (const p of section.placements ?? []) {
      // A break placement carries no figureRef — skip it (US-004a).
      if (p.deletedAt != null || !p.figureRef || seen.has(p.figureRef)) continue;
      seen.add(p.figureRef);
      const fig = figures[p.figureRef];
      if (!fig) continue;
      const counts = [
        ...new Set((fig.attributes ?? []).filter((a) => a.deletedAt == null).map((a) => a.count)),
      ].sort((a, b) => a - b);
      out.push({ figureRef: p.figureRef, name: fig.name, figureType: fig.figureType, counts });
    }
  }
  return out;
}

/**
 * Author a ROUTINE-scoped journal entry (LOCKED full-parity #1): open the routine's
 * editable store and createAnnotation with the built anchor(s). Resolves once the
 * annotation is applied locally (so it has been sent over the routine WS); the DO
 * persists it and projects it to journal_entry on its next (coalesced) alarm.
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
): Promise<void> {
  const store = openRoutineView(routineRef, {
    editable: true,
    getToken: opts.getToken,
    currentUserId: opts.currentUserId,
    baseUrl: opts.baseUrl,
    hydrationTimeoutMs: 12_000,
  });
  const timeoutMs = opts.timeoutMs ?? 15_000;
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
        const present = store
          .readAnnotations()
          .some((a) => a.text === input.text && a.kind === input.kind && a.deletedAt == null);
        if (present) finish();
      };
      const unsub = store.subscribe(tryProgress);
      tryProgress();
    });
    // Let the WS frame flush to the DO before we tear the socket down.
    await new Promise((r) => setTimeout(r, 250));
  } finally {
    store.close();
  }
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

/** The display label for a link chip (the server pre-resolves `label`; fallback otherwise). */
export function chipLabel(anchor: JournalAnchor): string {
  const t = pickMessages(journalMessages);
  if (anchor.label) return anchor.label;
  if (anchor.type === "point") return t.stepChip((anchor.count ?? 0) + 1);
  if (anchor.type === "figure") return anchor.figureRef ?? t.thisFigureChip;
  return anchor.figureType ?? t.figureChip;
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

/** A figure family for the link picker FIGURE step (distinct across the catalog). */
export interface FigureFamilyOption {
  figureType: string;
  name: string;
  dance: string;
  /** How many figures share this family (the "N steps" hint in the design). */
  count: number;
}

/**
 * The distinct figure families from the library catalog (first-seen name/dance),
 * for the link picker's FIGURE step. Stable order = catalog order.
 */
export function figureFamilies(): FigureFamilyOption[] {
  const out: FigureFamilyOption[] = [];
  const byType = new Map<string, FigureFamilyOption>();
  for (const f of LIBRARY_FIGURES) {
    const existing = byType.get(f.figureType);
    if (existing) {
      existing.count += 1;
    } else {
      const opt: FigureFamilyOption = {
        figureType: f.figureType,
        name: f.name,
        dance: f.dance,
        count: 1,
      };
      byType.set(f.figureType, opt);
      out.push(opt);
    }
  }
  return out;
}
