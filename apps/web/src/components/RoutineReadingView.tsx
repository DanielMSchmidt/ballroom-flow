// Reading lens (Builder v3 — Assemble · READING). A clean, read-only
// "programme" of the whole routine: a COLUMN-PICKER chips row (tap a chip to
// pick up to 4 technique columns, laid side-by-side across EVERY figure —
// picking a 5th drops the oldest, the last pick can't be removed; remembered
// per device, across choreos), a hand-written hint line, then per section a
// SectionDivider, then per figure a two-line header (name + beat-token timing
// sub) over a count × picked-columns table. The right 29% of every figure is
// the NOTES MARGIN: each step row (and the figure header) carries a margin
// cell with the note authors' avatars, a ＋ add affordance (commenter+), and
// the latest note as a two-line Caveat snippet — tapping the cell opens that
// anchor's thread. Off-beat (sub-beat) rows render dimmed.
//
// Pure presentation over the same store reads (no editing, no I/O). A null
// figure is rendered honestly per its load status (skeleton / unavailable),
// never silently dropped (#94).
import {
  type Annotation,
  type Attribute,
  DANCES,
  type DanceId,
  type FigureDoc,
  figureMatchesLibraryOrigin,
  figureTypeNoteCount,
  matchesFigureType,
  matchPredicate,
  type NumberedBeatEntry,
  numberRoutineBeats,
  type PlacementPart,
  partBeatSpan,
  partitionByActivity,
  type RegistryKind,
  type RoutineBeatEntry,
  type RoutineDoc,
  resolveFigureCounts,
  slowQuickTokens,
  windowAttributes,
} from "@weavesteps/domain";
import { memo, useMemo, useRef, useState } from "react";
import { useMessages } from "../i18n";
import { timelineMessages } from "../i18n/messages/timeline";
import type { FamilyNote } from "../store/family-notes";
import type { PredicateNote } from "../store/predicate-notes";
import type { FigureLoadStatus, ResolvedPlacement } from "../store/routine";
import { AttrChip, cx, IDENTITY_COLORS, kindVar, MediaChip, SectionDivider, Skeleton } from "../ui";
import type { FigureScope } from "../ui/tokens";
import { AttributeInfoSheet } from "./AttributeInfoSheet";
import {
  cellPresent,
  cellValue,
  columnUsage,
  infoKindsForColumn,
  isColumnKind,
  isOffBeatCount,
  type ReadingColumn,
  usedColumns,
} from "./reading-columns";
// (windowAttributes/resolveFigureCounts arrive via the domain import above)
import { shownReadColumns, useStoredReadColumns } from "./reading-shown";
import type { TimingView } from "./reading-timing";
import { filterByRoleView, type RoleView } from "./role-view";

/** The notes margin's share of the row (Builder v3: `flex:0 0 29%`). */
const MARGIN_BASIS = "29%";

/**
 * A note as the margin cell reads it — the common shape a routine annotation and
 * a figure-family note both fold into so ONE ordered set (newest-first) fills a
 * cell's avatars + latest-snippet. `createdAt` drives the ordering; a co-member
 * family note whose REST projection carries no authored time sorts as oldest
 * (0) — see {@link FamilyNote.createdAt}. `family` tags a family-scope note so
 * the cell can distinguish it within the margin's own vocabulary (a sr-only
 * scope word, never a new visual).
 */
interface MarginNote {
  id: string;
  authorId: string;
  text: string;
  createdAt: number;
  /** The note's category within the margin's vocabulary — drives the SR-only
   *  scope cue read before the snippet (#285: a predicate note is NOT a family
   *  note, so it must not be announced as one). `"routine"` carries no cue. */
  scope: "routine" | "family" | "predicate";
  /** Live image/video counts for the compact MediaChip (YouTube counts as video).
   *  docs/concepts/annotations.md § Media: the margin shows a chip, NEVER the media. */
  images: number;
  videos: number;
}

/** Count an annotation's LIVE media items by chip bucket (YouTube counts as video). */
function mediaCounts(media: Annotation["media"]): { images: number; videos: number } {
  let images = 0;
  let videos = 0;
  for (const m of media ?? []) {
    if (m.deletedAt != null) continue;
    if (m.type === "image") images += 1;
    else videos += 1;
  }
  return { images, videos };
}

/** Adapt a routine annotation into the unified margin shape (never a family note). */
function annotationMarginNote(a: Annotation): MarginNote {
  return {
    id: a.id,
    authorId: a.authorId,
    text: a.text,
    createdAt: a.createdAt,
    scope: "routine",
    ...mediaCounts(a.media),
  };
}

/** Adapt a figure-family note into the unified margin shape. */
function familyMarginNote(n: FamilyNote): MarginNote {
  return {
    id: n.id,
    authorId: n.authorId,
    text: n.text,
    // A co-member note's REST projection has no authored time — sort it oldest
    // rather than fabricate a "now" that would jump it to the top on every load.
    createdAt: n.createdAt ?? 0,
    scope: "family",
    // Family/predicate notes carry no media (media rides routine annotations only).
    images: 0,
    videos: 0,
  };
}

/** Adapt a predicate note into the unified margin shape. It rides the same margin
 *  envelope as a family note but is a DISTINCT anchor type (a content predicate,
 *  not a figure-identity note), so it carries its own SR-only cue (#285). */
function predicateMarginNote(n: PredicateNote): MarginNote {
  return {
    id: n.id,
    authorId: n.authorId,
    text: n.text,
    createdAt: n.createdAt ?? 0,
    scope: "predicate",
    images: 0,
    videos: 0,
  };
}

/** Merge routine + family margin notes into ONE newest-first set. Ties (equal
 *  `createdAt`, e.g. co-member notes at 0) keep a stable order by id so the
 *  cell's avatar cluster + latest snippet don't churn between renders. */
function mergeMarginNotes(routine: MarginNote[], family: MarginNote[]): MarginNote[] {
  return [...routine, ...family].sort(
    (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** One predicate note matched to a set of counts on a figure — the reading view's
 *  per-figure predicate slice (the note surfaces on each matched count row). */
interface PredicateMatch {
  note: PredicateNote;
  counts: number[];
}

export function RoutineReadingView({
  routine,
  placements,
  annotations = [],
  familyNotes = NO_FAMILY_NOTES,
  predicateNotes = NO_PREDICATE_NOTES,
  canComment = false,
  memberColors,
  memberNames,
  customKinds = [],
  roleView,
  timingView = "counts",
  onOpenFigure,
  onOpenThread,
  collapsedSections,
  onToggleSection,
  now,
}: {
  routine: RoutineDoc;
  placements: ResolvedPlacement[];
  /** Annotations on this routine — surfaced in the notes margin beside their step. */
  annotations?: Annotation[];
  /** Figure-family notes (US-040/041, own + co-members') that apply to this
   *  routine's figures — folded into the SAME margin cells as routine
   *  annotations. A whole-figure note lands on the figure-header cell; a WEP-0004
   *  timed note lands on its count row (soft-fallback to the header when a shorter
   *  variant doesn't cover the count). The caller (Assemble) passes the already
   *  co-membership-gated, deduped set; matching to figures happens here. */
  familyNotes?: FamilyNote[];
  /** Attribute-predicate notes (own + co-members') visible on this routine. Each
   *  surfaces on every step whose notation matches its predicate — computed here
   *  via matchPredicate over the already-resolved figures, folded into the SAME
   *  margin count cells as timed family notes. This is the first content-dependent
   *  read path, so the per-figure slices keep referential stability. */
  predicateNotes?: PredicateNote[];
  /** Whether THIS member may add a comment (commenter/editor — NOT a viewer).
   *  Gates the margin's ＋ add affordance (a viewer reads notes only). */
  canComment?: boolean;
  /** Real `authorId → stored hex` map built from `useMembers` + `useMe` by the
   *  caller (Assemble). When an authorId is found here, the margin avatar uses
   *  the stored colour directly. Unknown authors fall back to the hash. */
  memberColors?: Record<string, string>;
  /** `authorId → display name` map (same source) — drives the initial inside
   *  the margin avatar (colour is never the only signal — #5). */
  memberNames?: Record<string, string>;
  /** User-defined kinds merged into the registry (US-043) — so the attribute info
   *  overlay (frame 1.13) can describe a custom kind's prose/values too. */
  customKinds?: RegistryKind[];
  /** The active Leader/Follower lens (controlled — persisted by the caller,
   *  who renders the compact L·F toggle in the screen header). */
  roleView: RoleView;
  /** How step timings read: numeric counts (default) or slow/quick syllables
   *  (Tango/Foxtrot/Quickstep). Controlled + persisted by the caller. */
  timingView?: TimingView;
  /** Tap a figure name → Figure detail (existing open-figure flow). */
  onOpenFigure?: (figureId: string) => void;
  /** Tap a margin cell → open the annotation thread for that anchor (QUAL-2:
   *  passes the specific figureRef + count so the caller can focus the panel
   *  on the right anchor). A whole-figure cell omits `count` (US-004a). */
  onOpenThread?: (anchor: { figureRef: string; count?: number }) => void;
  /** Folded section ids (Builder v3: tap a divider → collapse). CONTROLLED by
   *  the caller — Assemble shares ONE Set across the edit and reading lenses,
   *  so a section folded while editing arrives folded here and vice versa. */
  collapsedSections?: ReadonlySet<string>;
  /** Tap a section divider → flip its fold. Omitted (e.g. in a context with no
   *  fold state) the dividers stay the plain non-interactive eyebrow rows. */
  onToggleSection?: (sectionId: string) => void;
  /**
   * Evaluation instant for comment activity fade-out (docs/concepts/annotations.md
   * § Where notes appear): each margin cell derives its snippet/avatars from its
   * ACTIVE routine comments only. Captured once per view mount and passed down as
   * a stable scalar (docs/system/sync-and-offline.md § Flicker) — never a fresh
   * `now` per render. Injected in tests; defaults to the mount instant.
   */
  now?: number;
}) {
  const t = useMessages(timelineMessages);
  const dance = routine.dance;
  // Fade-out evaluation instant, mount-stable: the partition is derived per
  // render from identity-stable inputs plus this scalar, so React.memo bail-outs
  // hold. A view left open across a window boundary re-evaluates on remount.
  const [mountNow] = useState(() => Date.now());
  const evalNow = now ?? mountNow;
  const resolvedByPlacement = useMemo(
    () => new Map(placements.map((p) => [p.placement.id, p])),
    [placements],
  );
  // Continuous beat numbering (US-004a): one running counter threads the whole
  // routine in placement order, wrapping at the dance's phrase length. Breaks
  // advance it too. We compute it ONCE here and hand each placement its result;
  // the edit view keeps per-figure LOCAL counts (this is display-only).
  // MEMOIZED on the STRUCTURAL inputs (sections + resolved placements — both
  // identity-stable across annotation-only changes thanks to the store's
  // reconcile), so an added note re-uses every beat-token array and the
  // memoized FigureReadouts below can bail out.
  const numberByPlacement = useMemo(
    () =>
      numberRoutineBeats_forRoutine(
        routine.sections,
        resolvedByPlacement,
        roleView,
        dance,
        timingView,
      ),
    [routine.sections, resolvedByPlacement, roleView, dance, timingView],
  );
  // Per-figure annotation slices with STABLE identities: only the slice of the
  // figure whose notes changed gets a new array — every other FigureReadout
  // sees reference-equal props and skips its re-render (React.memo below).
  const annotationsByFigure = useStableAnnotationsByFigure(annotations);
  // Per-figure family-note slices (US-040/041), stable-identity in the same way:
  // only the figure whose applicable family notes changed gets a new array, so an
  // added family note doesn't re-render every FigureReadout. Keyed by figure id
  // (a family note applies to a figure by figureType+dance identity, so it can
  // land on several figures at once).
  const figures = useMemo(
    () => placements.map((p) => p.figure).filter((f): f is FigureDoc => f != null),
    [placements],
  );
  const familyNotesByFigure = useStableFamilyNotesByFigure(familyNotes, figures);
  const predicateMatchesByFigure = useStablePredicateNotesByFigure(
    predicateNotes,
    figures,
    routine.id,
    roleView,
  );
  // The column picker (Builder v3): the reader's picked column ids, per device
  // + across choreos. The chips row covers every type USED anywhere in this
  // routine (under the active role lens — same "only what's set" rule as the
  // tables); every figure renders exactly the picked columns.
  const [pickedColumns, togglePickedColumn] = useStoredReadColumns();
  const routineColumns = useMemo(() => {
    const all: Attribute[] = [];
    for (const rp of placements) {
      if (!rp.figure) continue;
      all.push(
        ...filterByRoleView(
          rp.figure.attributes.filter((a) => a.deletedAt == null),
          roleView,
        ),
      );
    }
    return usedColumns(all, dance);
  }, [placements, roleView, dance]);
  const shownColumns = useMemo(
    () => shownReadColumns(pickedColumns, routineColumns),
    [pickedColumns, routineColumns],
  );
  const onChipTap = (col: ReadingColumn) => {
    // The last shown column can't be removed (min 1 — Builder v3).
    if (shownColumns.length === 1 && shownColumns[0]?.id === col.id) return;
    togglePickedColumn(col.id);
  };
  return (
    <div data-testid="reading-view" className="flex flex-col gap-[10px]">
      {/* Column picker (Builder v3): one chip per used type — tap to pick up
          to 4 columns, laid side-by-side across EVERY figure. The
          Leader/Follower lens lives in the screen header (Assemble). */}
      {routineColumns.length > 0 && (
        <>
          <fieldset
            data-tour="type-chips"
            aria-label={t.shownColumns}
            className="flex flex-wrap items-center gap-[5px]"
          >
            {routineColumns.map((col) => (
              <FilterChip
                key={col.id}
                column={col}
                on={shownColumns.some((c) => c.id === col.id)}
                customKinds={customKinds}
                onTap={onChipTap}
              />
            ))}
          </fieldset>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] bg-accent-tint"
            >
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--bf-accent)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 11.5a8.38 8.38 0 0 1-8.9 8.4 8.5 8.5 0 0 1-3.8-.9L3 20l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.4-8.9 8.5 8.5 0 0 1 8.6 8.4z" />
              </svg>
            </span>
            <span
              className="flex-1 text-[14px] text-ink-faint"
              style={{ fontFamily: "var(--bf-font-note)" }}
            >
              {t.readingHint}
            </span>
          </div>
        </>
      )}

      {routine.sections.length === 0 ? (
        <p className="text-2xs text-ink-faint">{t.noSections}</p>
      ) : (
        routine.sections.map((section) => {
          // Folding is DISPLAY-ONLY: the beat numbering above is computed from
          // the sections themselves, so a hidden section still occupies its
          // span and the visible ones keep their real running counts.
          const isCollapsed =
            onToggleSection != null && (collapsedSections?.has(section.id) ?? false);
          return (
            <section key={section.id} className="flex flex-col gap-[12px]">
              <SectionDivider
                label={section.name}
                collapsed={isCollapsed}
                onToggle={onToggleSection && (() => onToggleSection(section.id))}
                toggleLabel={
                  isCollapsed ? t.expandSection(section.name) : t.collapseSection(section.name)
                }
                meta={
                  isCollapsed
                    ? t.figCount(section.placements.filter((pl) => pl.source !== "break").length)
                    : undefined
                }
              />
              {isCollapsed ? null : section.placements.length === 0 ? (
                <p className="text-2xs text-ink-faint">{t.noFiguresInSection}</p>
              ) : (
                section.placements.map((pl) => {
                  const numbered = numberByPlacement.get(pl.id);
                  if (pl.source === "break") {
                    return (
                      <BreakReadout
                        key={pl.id}
                        numbered={numbered?.kind === "break" ? numbered : undefined}
                      />
                    );
                  }
                  const rp = resolvedByPlacement.get(pl.id);
                  const figureId = rp?.figure?.id;
                  return (
                    <FigureReadout
                      key={pl.id}
                      figure={rp?.figure ?? null}
                      status={rp?.status ?? "loading"}
                      part={pl.part ?? null}
                      roleView={roleView}
                      columns={shownColumns}
                      beatTokens={numbered?.kind === "figure" ? numbered.tokens : NO_TOKENS}
                      annotations={
                        (figureId && annotationsByFigure.get(figureId)) || NO_ANNOTATIONS
                      }
                      familyNotes={
                        (figureId && familyNotesByFigure.get(figureId)) || NO_FAMILY_NOTES
                      }
                      predicateMatches={
                        (figureId && predicateMatchesByFigure.get(figureId)) || NO_PREDICATE_MATCHES
                      }
                      canComment={canComment}
                      memberColors={memberColors}
                      memberNames={memberNames}
                      customKinds={customKinds}
                      scopeLabel={routine.title}
                      now={evalNow}
                      onOpenFigure={onOpenFigure}
                      onOpenThread={onOpenThread}
                    />
                  );
                })
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

// Stable empties: a figure with no notes / no beats must receive the SAME
// array identity every render, or React.memo could never bail for it.
const NO_ANNOTATIONS: Annotation[] = [];
const NO_FAMILY_NOTES: FamilyNote[] = [];
const NO_PREDICATE_NOTES: PredicateNote[] = [];
const NO_PREDICATE_MATCHES: PredicateMatch[] = [];
const NO_TOKENS: string[] = [];

/**
 * Group predicate notes by the figure they match, computing each note's matched
 * COUNTS via matchPredicate over the already-resolved figure — the first
 * content-dependent read path. Referential stability mirrors
 * {@link useStableFamilyNotesByFigure}: a figure whose matched (note-id × counts)
 * set is unchanged keeps its previous array identity, so an unrelated doc change
 * re-renders nothing. A routine-scoped anchor is confined to `routineId` here (a
 * bare figure doesn't know its routine); a figure placed twice slices once.
 *
 * Matching runs over the figure's attributes AS FILTERED BY THE ACTIVE ROLE LENS —
 * the exact set the reading table renders (`filterByRoleView`). This matters for
 * MIRRORED kinds (sway/turn/direction): a Both-lens sway edit splits into
 * leader `to_R` + follower `to_L` (the same physical lean, WEP-0008), so an
 * unfiltered match would surface a "left sway" note on the hidden follower value
 * while the leader lens shows only "right" (issue #284 — the note clinging to a
 * step whose visible value was retagged). Filtering to the lens keeps the note
 * tied to what the dancer actually sees on this side.
 */
function useStablePredicateNotesByFigure(
  predicateNotes: PredicateNote[],
  figures: FigureDoc[],
  routineId: string,
  roleView: RoleView,
): Map<string, PredicateMatch[]> {
  const prevRef = useRef<Map<string, PredicateMatch[]>>(new Map());
  return useMemo(() => {
    const next = new Map<string, PredicateMatch[]>();
    for (const figure of figures) {
      if (next.has(figure.id)) continue;
      // Match over the lens's projection — the same view the reading table shows.
      const lensFigure = {
        ...figure,
        attributes: filterByRoleView(figure.attributes, roleView),
      };
      const matches: PredicateMatch[] = [];
      for (const note of predicateNotes) {
        const anchor = note.anchors[0];
        if (anchor?.type !== "attributePredicate") continue;
        // Confine a routine-scoped anchor to its own routine (the caller's gate).
        if (anchor.scope === "routine" && anchor.routineRef !== routineId) continue;
        const counts = matchPredicate(anchor, lensFigure);
        if (counts.length > 0) matches.push({ note, counts });
      }
      if (matches.length > 0) next.set(figure.id, matches);
    }
    // Referential stability: reuse the previous per-figure array when the matched
    // (note-id × counts) shape is byte-for-byte unchanged.
    for (const [figureId, arr] of next) {
      const prev = prevRef.current.get(figureId);
      if (prev && sameMatches(prev, arr)) next.set(figureId, prev);
    }
    prevRef.current = next;
    return next;
  }, [predicateNotes, figures, routineId, roleView]);
}

/** Structural equality of two predicate-match slices (note id + matched counts). */
function sameMatches(a: PredicateMatch[], b: PredicateMatch[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y || x.note.id !== y.note.id) return false;
    if (x.counts.length !== y.counts.length) return false;
    for (let j = 0; j < x.counts.length; j++) {
      if (x.counts[j] !== y.counts[j]) return false;
    }
  }
  return true;
}

/**
 * Group family notes by the figure they apply to, keeping each group's ARRAY
 * IDENTITY stable across regroupings when its members are unchanged — the
 * family-note counterpart to {@link useStableAnnotationsByFigure}. A family note
 * matches a figure by figureType+dance IDENTITY (never a figureRef), so one note
 * can land on several figures at once; a tombstoned figure/note contributes
 * nothing. The result: adding a family note re-slices only the figures it
 * actually matches, so every other FigureReadout keeps its reference-equal prop.
 */
function useStableFamilyNotesByFigure(
  familyNotes: FamilyNote[],
  figures: FigureDoc[],
): Map<string, FamilyNote[]> {
  const prevRef = useRef<Map<string, FamilyNote[]>>(new Map());
  return useMemo(() => {
    const next = new Map<string, FamilyNote[]>();
    for (const figure of figures) {
      if (next.has(figure.id)) continue; // a figure placed twice slices once
      const matching = familyNotes.filter((n) =>
        n.anchors.some((anchor) => matchesFigureType(anchor, figure)),
      );
      if (matching.length > 0) next.set(figure.id, matching);
    }
    for (const [figureId, arr] of next) {
      const prev = prevRef.current.get(figureId);
      if (prev && prev.length === arr.length && prev.every((x, i) => x === arr[i])) {
        next.set(figureId, prev);
      }
    }
    prevRef.current = next;
    return next;
  }, [familyNotes, figures]);
}

/**
 * Group annotations by the figure they anchor to (point OR whole-figure
 * anchors), keeping each group's ARRAY IDENTITY stable across regroupings when
 * its members are unchanged. Annotation objects themselves are identity-stable
 * across snapshots (store reconcile), so "unchanged" is a cheap reference scan.
 * The result: adding a note to figure X hands ONLY X's FigureReadout a new
 * `annotations` prop.
 */
function useStableAnnotationsByFigure(annotations: Annotation[]): Map<string, Annotation[]> {
  const prevRef = useRef<Map<string, Annotation[]>>(new Map());
  return useMemo(() => {
    const next = new Map<string, Annotation[]>();
    for (const a of annotations) {
      if (a.deletedAt != null) continue;
      const seen = new Set<string>();
      for (const an of a.anchors) {
        if ((an.type === "point" || an.type === "figure") && !seen.has(an.figureRef)) {
          seen.add(an.figureRef);
          const arr = next.get(an.figureRef);
          if (arr) arr.push(a);
          else next.set(an.figureRef, [a]);
        }
      }
    }
    for (const [figureRef, arr] of next) {
      const prev = prevRef.current.get(figureRef);
      if (prev && prev.length === arr.length && prev.every((x, i) => x === arr[i])) {
        next.set(figureRef, prev);
      }
    }
    prevRef.current = next;
    return next;
  }, [annotations]);
}

/** A figure's distinct, sorted counts under the active role lens — the same
 *  derivation FigureReadout renders from, so numbering aligns with the rows. */
function figureCounts(
  figure: FigureDoc,
  roleView: RoleView,
  part?: PlacementPart | null,
): number[] {
  const live = windowAttributes(
    filterByRoleView(
      figure.attributes.filter((a) => a.deletedAt == null),
      roleView,
    ),
    part,
  );
  return [...new Set(live.map((a) => a.count))].sort((a, b) => a - b);
}

/** Number the whole routine's beats once (US-004a), returning a placement-id →
 *  numbered-entry map. Threads a single counter across every section/placement
 *  in order; each placement advances it by its LENGTH — the figure's authored
 *  counts, a portion window's beat span — never by how many steps it carries
 *  (a held Slow still occupies its beats). A null (loading/missing) figure
 *  contributes no beats (best effort). */
function numberRoutineBeats_forRoutine(
  sections: RoutineDoc["sections"],
  resolved: Map<string, ResolvedPlacement>,
  roleView: RoleView,
  dance: DanceId,
  timingView: TimingView = "counts",
): Map<string, NumberedBeatEntry | undefined> {
  const beatsPerBar = DANCES[dance].beatsPerBar;
  const ids: string[] = [];
  const entries: RoutineBeatEntry[] = [];
  for (const section of sections) {
    for (const pl of section.placements) {
      ids.push(pl.id);
      if (pl.source === "break") {
        entries.push({ kind: "break", beats: pl.beats ?? beatsPerBar });
        continue;
      }
      const fig = resolved.get(pl.id)?.figure ?? null;
      if (!fig) {
        entries.push({ kind: "figure", counts: [] });
        continue;
      }
      const part = pl.part ?? null;
      // Block-local counts: a portion window rebases so its first beat is 1
      // (same `from` rounding as windowAttributes/partBeatSpan).
      const from = part ? Math.max(1, Math.ceil(part.fromCount)) : 1;
      const counts = figureCounts(fig, roleView, part).map((c) => c - (from - 1));
      entries.push({
        kind: "figure",
        counts,
        beats: part ? partBeatSpan(part) : resolveFigureCounts(fig),
      });
    }
  }
  const numbered = numberRoutineBeats(entries, dance);
  if (timingView === "slowquick") {
    // Replace each figure's numeric tokens with slow/quick syllables. Breaks
    // keep their continuous beat span (a break has no rhythm to notate). Each
    // figure's tokens come from its OWN step durations, bounded by the block's
    // length (`beats` + 1 is the boundary the last step runs to).
    for (let i = 0; i < numbered.length; i++) {
      const entry = numbered[i];
      const source = entries[i];
      if (entry?.kind === "figure" && source?.kind === "figure") {
        entry.tokens = slowQuickTokens(source.counts, (source.beats ?? source.counts.length) + 1);
      }
    }
  }
  return new Map(ids.map((id, i) => [id, numbered[i]]));
}

/** A break/wait row in the reading view (US-004a): a muted row showing the beat
 *  span it occupies (e.g. "beats 4–6") + its bar count. Advances the counter. */
function BreakReadout({ numbered }: { numbered?: Extract<NumberedBeatEntry, { kind: "break" }> }) {
  const t = useMessages(timelineMessages);
  const span = numbered?.span ?? "break";
  const bars = numbered?.bars ?? 1;
  return (
    <div
      data-testid="break-readout"
      className="flex items-center gap-[7px] rounded-[7px] px-[8px] py-[6px]"
      style={{ background: "var(--bf-surface-sunken)" }}
    >
      <span aria-hidden="true" className="text-2xs font-bold text-ink-faint">
        ❚❚
      </span>
      <span className="text-2xs font-bold uppercase tracking-wider text-ink-muted">
        {t.breakLabel}
      </span>
      <span className="text-2xs text-ink-muted">{span}</span>
      <span className="text-2xs font-medium text-ink-faint">· {t.bars(bars)}</span>
    </div>
  );
}

/** The figure's badge scope, derived by content DIVERGENCE (not the copy
 *  mechanism): a frozen account copy carries its own attributes and `baseFigureRef`
 *  is provenance only — an account figure still matching its catalog origin reads
 *  Library, otherwise Custom (§2.5.1 #19–20). */
function figureScope(figure: FigureDoc): FigureScope {
  if (figure.scope === "global") return "library";
  return figureMatchesLibraryOrigin(figure) ? "library" : "custom";
}

/** The column's flex weight (Builder v3: the merged Step column gets 1.7×). */
function columnWeight(col: ReadingColumn): number {
  return col.isStep ? 1.7 : 1;
}

/** One figure's notation, read-only: a two-line header + a count × picked-
 *  columns table, with the notes margin owning the right 29% of every row.
 *  MEMOIZED: with the store's reconcile keeping figure/annotation identities
 *  stable, a note added elsewhere (or any unrelated doc change) leaves every
 *  prop reference-equal and this whole subtree skips its re-render — only the
 *  figure whose notes/content changed re-renders. */
const FigureReadout = memo(function FigureReadout({
  figure,
  status,
  part,
  roleView,
  columns,
  beatTokens,
  annotations,
  familyNotes,
  predicateMatches,
  canComment,
  memberColors,
  memberNames,
  customKinds = [],
  scopeLabel,
  now,
  onOpenFigure,
  onOpenThread,
}: {
  figure: FigureDoc | null;
  status: FigureLoadStatus;
  /** Portion window (Builder v3 ③) — dance only these counts of the figure. */
  part?: PlacementPart | null;
  roleView: RoleView;
  /** The routine-wide PICKED columns (Builder v3) — every figure renders
   *  exactly these; a figure without the kind shows empty dots. */
  columns: ReadingColumn[];
  /** The continuous beat token per distinct sorted count (US-004a), aligned to
   *  this figure's `counts`. Drives the timing sub + per-step count cell. */
  beatTokens: string[];
  annotations: Annotation[];
  /** Family notes (own + co-members') that match THIS figure's family — folded
   *  into the same margin cells as the routine annotations (whole-figure onto the
   *  header, timed onto their count row). */
  familyNotes: FamilyNote[];
  /** Predicate notes matched to THIS figure with their matched counts — each folds
   *  onto every matched count row (parity with a timed family note's count cell). */
  predicateMatches: PredicateMatch[];
  canComment: boolean;
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
  customKinds?: RegistryKind[];
  scopeLabel?: string;
  /** Fade-out evaluation instant (mount-stable scalar) — the margin cell shows
   *  ACTIVE routine comments' snippet/avatars only (docs/concepts/annotations.md
   *  § Where notes appear). Family notes are exempt (they merge in unpartitioned). */
  now: number;
  onOpenFigure?: (figureId: string) => void;
  onOpenThread?: (anchor: { figureRef: string; count?: number }) => void;
}) {
  // The attribute kind whose info overlay is open (frame 1.13), or null. Tapping
  // a value chip or a column header opens the plain-language reference. State is
  // per-figure so usage counts + columns are scoped to the figure that was tapped.
  const [infoCol, setInfoCol] = useState<ReadingColumn | null>(null);
  const t = useMessages(timelineMessages);
  if (!figure) {
    // A loading figure shows a skeleton (never silently vanishes); a genuinely
    // unavailable one says so plainly. A transient error reads as unavailable
    // too — this is the read-only view, so there's no retry affordance here.
    if (status === "missing" || status === "error") {
      return (
        <p className="text-2xs text-ink-faint" role="status">
          {t.figureUnavailable}
        </p>
      );
    }
    return (
      <div aria-busy="true">
        <Skeleton className="w-32" />
        <span className="sr-only" role="status">
          {t.loadingFigure}
        </span>
      </div>
    );
  }
  // The Leader/Follower lens: both-role attributes always show; role-specific
  // ones show only on their side (US: Follower flips role-aware values).
  const live = windowAttributes(
    filterByRoleView(
      figure.attributes.filter((a) => a.deletedAt == null),
      roleView,
    ),
    part,
  );
  const counts = [...new Set(live.map((a) => a.count))].sort((a, b) => a - b);
  // The continuous beat token per count (US-004a), zipped with the sorted counts.
  const tokenByCount = new Map(counts.map((c, i) => [c, beatTokens[i] ?? String(c)]));
  // Routine notes anchored to a specific step (point) of this figure — margin cells.
  const figureComments = annotations.filter(
    (a) =>
      a.deletedAt == null &&
      a.anchors.some((an) => an.type === "point" && an.figureRef === figure.id),
  );
  // Routine notes anchored to the WHOLE figure (figure anchor, no count — US-004a).
  const wholeFigureComments = annotations.filter(
    (a) =>
      a.deletedAt == null &&
      a.anchors.some((an) => an.type === "figure" && an.figureRef === figure.id),
  );
  // Fold the figure's family notes (own + co-members') onto its margin cells
  // (US-040/041): a TIMED note (WEP-0004) pins to its count when THIS figure
  // covers it — figureTypeNoteCount's soft fallback returns null for a shorter
  // variant, so an un-pinnable timed note degrades onto the figure header rather
  // than vanishing (parity with FamilyNotes.tsx). An untimed note is header-scope.
  const familyByCount = new Map<number, MarginNote[]>();
  const familyWholeFigure: MarginNote[] = [];
  for (const n of familyNotes) {
    const anchor = n.anchors[0];
    const pinned = anchor ? figureTypeNoteCount(anchor, figure) : null;
    if (pinned != null) {
      const arr = familyByCount.get(pinned);
      if (arr) arr.push(familyMarginNote(n));
      else familyByCount.set(pinned, [familyMarginNote(n)]);
    } else {
      familyWholeFigure.push(familyMarginNote(n));
    }
  }
  // Predicate notes surface on each of their matched count rows (the count cell
  // machinery timed family notes use). A matched count the figure doesn't render
  // (e.g. an off-window count) is simply dropped — the note stays on the counts
  // that ARE shown, or falls to the header when none are.
  const shownCounts = new Set(counts);
  for (const { note, counts: matched } of predicateMatches) {
    const cell = predicateMarginNote(note);
    const here = matched.filter((c) => shownCounts.has(c));
    if (here.length === 0) {
      familyWholeFigure.push(cell);
      continue;
    }
    for (const c of here) {
      const arr = familyByCount.get(c);
      if (arr) arr.push(cell);
      else familyByCount.set(c, [cell]);
    }
  }
  // Comment activity fade-out (docs/concepts/annotations.md § Where notes appear):
  // each margin cell derives its snippet/avatars from its ACTIVE routine comments
  // only — partition the per-cell routine list (the rule's granularity), keep the
  // active side, then map to margin notes (partition needs `replies`, which the
  // flattened MarginNote drops). Family notes are EXEMPT: co-members' family notes
  // can lack an authored time and have no expander behind the cell, so they always
  // render (merged in unpartitioned, exactly as before).
  //
  // The header cell: ACTIVE routine whole-figure notes ∪ untimed/soft-fallback
  // family notes, newest-first across both.
  const headerNotes = mergeMarginNotes(
    partitionByActivity(wholeFigureComments, now).active.map(annotationMarginNote),
    familyWholeFigure,
  );
  return (
    <div className="relative flex flex-col gap-[5px]">
      {/* The vertical rule between the notation and the notes margin. */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 top-[2px] w-[1.5px]"
        style={{ right: MARGIN_BASIS, background: "var(--bf-border-subtle)" }}
      />
      {/* Figure header row: scope dot + two-line name / timing sub, then the
          whole-figure notes margin cell. */}
      <div className="flex items-stretch">
        <div className="flex min-w-0 flex-1 items-center gap-2 pr-[10px]">
          <ScopeDot scope={figureScope(figure)} />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="block max-w-full truncate text-left text-[14px] font-bold text-ink hover:underline"
              onClick={() => onOpenFigure?.(figure.id)}
            >
              {figure.name}
            </button>
            <div className="truncate text-2xs font-semibold text-ink-faint">
              {counts.length > 0 ? beatTokens.join(" ") : t.emptyFigureSub}
              {part &&
                ` · ${t.partLabel(part.fromCount, part.toCount, resolveFigureCounts(figure))}`}
            </div>
          </div>
        </div>
        <NotesMarginCell
          label={t.notesForFigure(figure.name)}
          notes={headerNotes}
          canComment={canComment}
          memberColors={memberColors}
          memberNames={memberNames}
          onOpen={onOpenThread && (() => onOpenThread({ figureRef: figure.id }))}
        />
      </div>

      {counts.length > 0 && (
        <>
          {/* Column header row + the NOTES margin label. */}
          <div className="flex items-stretch">
            <div className="flex min-h-[36px] min-w-0 flex-1 items-center gap-1 pr-[10px]">
              <span className="w-[18px] flex-none" aria-hidden="true" />
              {columns.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  aria-label={t.aboutColumn(col.label)}
                  onClick={() => setInfoCol(col)}
                  className="min-w-0 cursor-pointer py-[6px] text-center text-2xs font-bold leading-none tracking-wide"
                  style={{ flexGrow: columnWeight(col), flexBasis: 0, color: columnColor(col) }}
                >
                  {col.label}
                </button>
              ))}
            </div>
            <div
              className="flex flex-none items-center pl-[10px]"
              style={{ flexBasis: MARGIN_BASIS }}
            >
              <span className="text-[8px] font-bold tracking-[.06em] text-ink-faint">
                {t.notesHeader}
              </span>
            </div>
          </div>
          <ol className="flex flex-col gap-[5px]" aria-label={t.figureSteps(figure.name)}>
            {counts.map((count) => (
              <StepRow
                key={count}
                count={count}
                label={tokenByCount.get(count) ?? String(count)}
                columns={columns}
                here={live.filter((a) => a.count === count)}
                notes={mergeMarginNotes(
                  partitionByActivity(
                    figureComments.filter((a) =>
                      a.anchors.some((an) => an.type === "point" && an.count === count),
                    ),
                    now,
                  ).active.map(annotationMarginNote),
                  familyByCount.get(count) ?? [],
                )}
                figureId={figure.id}
                canComment={canComment}
                memberColors={memberColors}
                memberNames={memberNames}
                onOpenInfo={setInfoCol}
                onOpenThread={onOpenThread}
              />
            ))}
          </ol>
        </>
      )}

      {/* The attribute explainer (Builder v2 — a full page) — opened by tapping a
          value chip or a column header. The merged Step column describes
          direction + footwork. The footer pager walks the picked columns. */}
      {infoCol &&
        (() => {
          const [primary, ...rest] = infoKindsForColumn(infoCol, customKinds, live);
          if (!primary) return null;
          const idx = columns.findIndex((c) => c.id === infoCol.id);
          const prev = columns[(idx - 1 + columns.length) % columns.length];
          const next = columns[(idx + 1) % columns.length];
          const pager =
            columns.length > 1 && idx >= 0 && prev && next
              ? {
                  prevLabel: prev.label,
                  nextLabel: next.label,
                  positionLabel: t.pagerPosition(idx + 1, columns.length),
                  onPrev: () => setInfoCol(prev),
                  onNext: () => setInfoCol(next),
                }
              : undefined;
          return (
            <AttributeInfoSheet
              open
              kind={primary}
              extraKinds={rest}
              title={infoCol.isStep ? infoCol.label : undefined}
              usageCount={columnUsage(live, [primary, ...rest])}
              scopeLabel={scopeLabel}
              onClose={() => setInfoCol(null)}
              pager={pager}
            />
          );
        })()}
    </div>
  );
});

/** One column-picker chip (Builder v3): ON = the kind's tint/ink/border family
 *  (this column is laid out); OFF = dashed grey over the plain surface (grey
 *  stays "empty / off", never data). A custom kind passes its registry color
 *  through (border/ink + a leading dot, like AttrChip) so user-defined types
 *  sit in the row like builtins. */
function FilterChip({
  column,
  on,
  customKinds,
  onTap,
}: {
  column: ReadingColumn;
  on: boolean;
  customKinds: RegistryKind[];
  onTap: (col: ReadingColumn) => void;
}) {
  const t = useMessages(timelineMessages);
  const family = columnChipFamily(column, customKinds);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? t.hideColumn(column.label) : t.showColumn(column.label)}
      onClick={() => onTap(column)}
      className={cx(
        "inline-flex min-h-[36px] items-center gap-1 rounded-[6px] border-[1.5px] px-2 py-1 text-2xs leading-none",
        on ? "font-bold" : "border-dashed font-semibold",
      )}
      style={
        on
          ? { background: family.tint, color: family.ink, borderColor: family.border }
          : {
              background: "var(--bf-surface)",
              color: "var(--bf-ink-faint)",
              borderColor: "var(--bf-border-strong)",
            }
      }
    >
      {column.label}
      {family.dot && on && (
        <span
          aria-hidden="true"
          className="h-[6px] w-[6px] flex-none rounded-full"
          style={{ background: family.dot }}
        />
      )}
    </button>
  );
}

/** A chip's ON color family: standard kinds use their token family; a custom
 *  kind passes its stored color through as border/ink over a neutral tint,
 *  plus a leading dot (the AttrChip treatment — DESIGN-PRINCIPLES #24). */
function columnChipFamily(
  col: ReadingColumn,
  customKinds: RegistryKind[],
): { tint: string; ink: string; border: string; dot?: string } {
  if (isColumnKind(col.kind)) {
    return {
      tint: kindVar(col.kind, "tint"),
      ink: kindVar(col.kind, "ink"),
      border: kindVar(col.kind, "border"),
    };
  }
  const custom = customKinds.find((k) => k.kind === col.kind)?.color;
  return {
    tint: "var(--bf-surface-sunken)",
    ink: custom ?? "var(--bf-ink-secondary)",
    border: custom ?? "var(--bf-border-strong)",
    dot: custom,
  };
}

/** A column's header/text color — the kind's base token, slate for unknowns. */
function columnColor(col: ReadingColumn): string {
  return isColumnKind(col.kind) ? kindVar(col.kind) : "var(--bf-ink-secondary)";
}

/** One step row: the sunken notation strip (count cell + a chip-or-dot per
 *  picked column) then the step's notes margin cell. Off-beat (sub-beat) rows
 *  render dimmed. */
function StepRow({
  count,
  label,
  columns,
  here,
  notes,
  figureId,
  canComment,
  memberColors,
  memberNames,
  onOpenInfo,
  onOpenThread,
}: {
  count: number;
  /** The continuous beat token to display in the count cell (US-004a). */
  label: string;
  columns: ReadingColumn[];
  here: Attribute[];
  /** This count's margin notes, already merged (routine + family) newest-first. */
  notes: MarginNote[];
  figureId: string;
  canComment: boolean;
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
  /** Tapping a value chip opens that kind's attribute info overlay (frame 1.13). */
  onOpenInfo: (col: ReadingColumn) => void;
  onOpenThread?: (anchor: { figureRef: string; count?: number }) => void;
}) {
  const t = useMessages(timelineMessages);
  const offBeat = isOffBeatCount(count);
  return (
    <li className="flex items-stretch">
      <div className="flex min-w-0 flex-1 pr-[10px]">
        <div
          data-offbeat={offBeat ? "true" : undefined}
          className="flex min-h-[40px] flex-1 items-stretch gap-1 rounded-[8px] bg-surface-muted px-[5px] py-[5px]"
        >
          <span
            className={cx(
              "w-[18px] flex-none self-center text-center font-bold tabular-nums",
              offBeat ? "text-[10px] text-ink-faint" : "text-[12px] text-accent",
            )}
          >
            {label}
          </span>
          {columns.map((col) => {
            const value = cellValue(here, col);
            return (
              <span
                key={col.id}
                className="flex min-w-0 items-center justify-center"
                style={{ flexGrow: columnWeight(col), flexBasis: 0 }}
              >
                {value ? (
                  <button
                    type="button"
                    aria-label={t.aboutValue(col.label, value)}
                    onClick={() => onOpenInfo(col)}
                    className="max-w-full cursor-pointer"
                  >
                    <AttrChip kind={col.kind} label={value} />
                  </button>
                ) : cellPresent(here, col) ? (
                  <PresentSlot color={columnColor(col)} />
                ) : (
                  <EmptySlot />
                )}
              </span>
            );
          })}
        </div>
      </div>
      <NotesMarginCell
        label={t.notesForCount(label)}
        notes={notes}
        canComment={canComment}
        memberColors={memberColors}
        memberNames={memberNames}
        onOpen={onOpenThread && (() => onOpenThread({ figureRef: figureId, count }))}
      />
    </li>
  );
}

/** A notes-margin cell (Builder v3): the note authors' avatars (newest-first,
 *  up to 3 — initial inside the dot, colour never the only signal #5), a ＋
 *  add chip for a member who may comment, and the latest note as a two-line
 *  Caveat snippet. The whole cell is one tap target opening the anchor's
 *  thread (a viewer may read it; only a commenter may add).
 *
 *  `notes` is the ALREADY-MERGED set (routine annotations ∪ family notes ∪
 *  predicate notes), ordered newest-first — so `notes[0]` is the snippet and
 *  avatars read forward. A non-routine note carries a sr-only scope cue keyed to
 *  its `scope` ("family note" / "attribute note", #285) so it never reads as a
 *  here-and-now comment and a predicate note is not miscategorized as a family
 *  one — an affordance already in the margin's vocabulary (colour/initial +
 *  text), no new visual. */
function NotesMarginCell({
  label,
  notes,
  canComment,
  memberColors,
  memberNames,
  onOpen,
}: {
  label: string;
  notes: MarginNote[];
  canComment: boolean;
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
  onOpen?: () => void;
}) {
  const t = useMessages(timelineMessages);
  const latest = notes[0];
  // Distinct authors, newest first (Builder v3 `_margin`), capped at 3.
  const authors: string[] = [];
  for (const n of notes) {
    if (authors.length >= 3) break;
    if (!authors.includes(n.authorId)) authors.push(n.authorId);
  }
  // Aggregate media across this cell's notes for the compact chip (never the media).
  const mediaTotals = notes.reduce(
    (acc, n) => ({ images: acc.images + n.images, videos: acc.videos + n.videos }),
    { images: 0, videos: 0 },
  );
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onOpen}
      className="flex min-h-[40px] min-w-0 flex-none cursor-pointer flex-col justify-center gap-[3px] pl-[10px] text-left"
      style={{ flexBasis: MARGIN_BASIS }}
    >
      <span className="flex items-center gap-[3px]">
        {authors.map((id) => (
          <span
            key={id}
            data-avatar
            className="flex h-[16px] w-[16px] flex-none items-center justify-center rounded-full text-[8px] font-bold text-ink-inverse"
            style={{ background: memberColors?.[id] ?? identityColor(id) }}
          >
            {authorInitial(memberNames?.[id])}
          </span>
        ))}
        {canComment && (
          <span
            aria-hidden="true"
            className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-[1.5px] text-[12px] font-bold leading-none text-accent"
            style={{ borderColor: "var(--bf-accent-border)" }}
          >
            ＋
          </span>
        )}
      </span>
      {latest && (
        <span
          className="line-clamp-2 text-[12px] leading-[1.3] text-ink-secondary"
          style={{ fontFamily: "var(--bf-font-note)" }}
        >
          {latest.scope === "family" && <span className="bf-sr-only">{t.familyNoteScope} </span>}
          {latest.scope === "predicate" && (
            <span className="bf-sr-only">{t.predicateNoteScope} </span>
          )}
          {latest.text}
        </span>
      )}
      {/* Compact media chip — NEVER an img/video/iframe in the margin
          (docs/ideas/annotation-media-embeds.md). */}
      <MediaChip images={mediaTotals.images} videos={mediaTotals.videos} />
    </button>
  );
}

/** The author's display initial for the margin avatar — empty when unknown. */
function authorInitial(name: string | undefined): string {
  return name?.trim().charAt(0).toUpperCase() ?? "";
}

/** A stable identity color slot for an author (profile-colored avatar). */
function identityColor(authorId: string): string {
  let h = 0;
  for (let i = 0; i < authorId.length; i++) h = (h * 31 + authorId.charCodeAt(i)) >>> 0;
  return IDENTITY_COLORS[h % IDENTITY_COLORS.length] ?? "var(--bf-identity-1)";
}

/** The figure's scope dot — blue (library) / amber (custom). The visible scope
 *  word rides as sr-only text so the cue isn't color-only (#5). */
function ScopeDot({ scope }: { scope: FigureScope }) {
  const t = useMessages(timelineMessages);
  const color = scope === "library" ? kindVar("direction") : kindVar("footwork");
  return (
    <span className="inline-flex flex-none items-center">
      <span
        aria-hidden="true"
        className="h-[9px] w-[9px] rounded-full"
        style={{ background: color }}
      />
      <span className="bf-sr-only">{scope === "library" ? t.libraryFigure : t.customFigure}</span>
    </span>
  );
}

/** A notated-but-valueless step marker — a filled dot in the column's kind color
 *  (blue for the merged Step column). Distinguishes "a step is here, value not
 *  set yet" (Builder v3 ② presence) from a truly empty slot, so a step added
 *  without attributes still reads in the reading view. */
function PresentSlot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      data-present-cell
      className="h-[7px] w-[7px] rounded-full"
      style={{ background: color }}
    />
  );
}

/** An empty technique slot — a small ring dot (nothing logged here). */
function EmptySlot() {
  return (
    <span
      aria-hidden="true"
      className="h-[6px] w-[6px] rounded-full border-[1.5px]"
      style={{ borderColor: "var(--bf-border-strong)" }}
    />
  );
}
