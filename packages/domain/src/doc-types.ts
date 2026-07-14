// US-005 — Document-graph types (PLAN §2.2–2.6).
//
// The logical shapes of the Automerge document graph: a routine doc (sections →
// placements + annotations) and a figure doc (metadata + a float-count attribute
// timeline). These are the product types the builders/readers in doc-routine.ts
// / doc-figure.ts produce and consume.
//
// Every entity carries an optional `deletedAt` tombstone — removal is ALWAYS a
// mergeable flip, never a hard delete (§2.1), so a concurrent edit on a deleted
// entity still merges cleanly and the deletion is itself a CRDT value.
//
// These are `type` aliases, NOT `interface`s, on purpose: an object-literal type
// alias gets an implicit index signature and therefore satisfies Automerge's
// `from<T extends Record<string, unknown>>` constraint directly — an interface
// does not, and forces a cast at every doc-build site (CLAUDE.md §4). Don't
// convert them back.
import type { DanceId } from "./dances";
import type { RegistryKind } from "./vocabulary";

/** leader / follower / both (null). */
export type Role = "leader" | "follower" | null;
/** A figure-family identity that spans dances (US-011). */
export type FigureType = string;
export type DocScope = "global" | "account";
export type FigureSource = "library" | "custom";

/** An attribute placed on a figure's float-count timeline (§2.5). */
export type Attribute = {
  id: string;
  kind: string;
  /** Float count relative to figure start; fraction → e/&/a (US-004). */
  count: number;
  role?: Role;
  value: unknown;
  deletedAt?: number | null;
};

/** A figure document — global library entry or account variant/custom (§2.2). */
export type FigureDoc = {
  id: string;
  scope: DocScope;
  ownerId: string;
  figureType: FigureType;
  dance: DanceId;
  name: string;
  source: FigureSource;
  /**
   * The figure's authored length in COUNTS (beats, 1–64 — Builder v3 ①,
   * 2026-07-07): chosen on creation and adjustable in the editor's LENGTH
   * stepper, it drives the timing grid (every count → e/&/a slot) and every
   * derived bar display (`resolveFigureBars` = ⌈counts / beatsPerBar⌉).
   * Optional for lenient reads of pre-v5 docs, which authored `bars` instead —
   * `resolveFigureCounts` reads `bars × beatsPerBar` for those until the v4→v5
   * migration converts them in storage.
   */
  counts?: number;
  /**
   * LEGACY (pre-v5): the figure's authored length in whole bars. Superseded by
   * `counts` (the v4→v5 migration converts + drops this); kept optional so a
   * not-yet-migrated doc still reads leniently. Never write this field.
   */
  bars?: number;
  attributes: Attribute[];
  /**
   * The base this figure resolves against (§2.2, §5.2, ⟳v5). For a VARIANT this is
   * a LIVE link: the variant carries only its OWNED beats and resolves the rest
   * live from the base (`resolveFigure(base, variant)`), so catalog improvements
   * flow into untouched beats. Also powers lineage display + the "custom" badge.
   * Null for a standalone figure; a legacy frozen copy owns every beat, so its live
   * base changes nothing until the base adds beats the copy never used (back-compat).
   */
  baseFigureRef?: string | null;
  schemaVersion: number;
  deletedAt?: number | null;
};

export type Placement = {
  id: string;
  /**
   * The figure this placement references. Present for a normal figure placement;
   * ABSENT for a `break` (a break has no figure — see {@link Placement.source}).
   */
  figureRef?: string;
  /**
   * Entry kind. Omitted (the default) for a normal figure placement; `"break"`
   * for a WAIT/BREAK entry that occupies beats but has no figure or steps
   * (US-004a). A break carries {@link Placement.beats} and no `figureRef`; it
   * advances the routine's continuous beat counter and reads as a muted row.
   */
  source?: "break";
  /** A break's duration in whole beats (`source === "break"` only; min 1). */
  beats?: number;
  /**
   * Portion window (Builder v3 ③, 2026-07-07): dance only counts
   * [fromCount, toCount] of the referenced figure. The figure doc stays whole
   * and LIVE — reads window the resolved timeline (`windowAttributes`), a
   * catalog edit inside the window flows in, and the placement's bar
   * contribution is the window's whole-beat span (`partBeatSpan`). Absent →
   * the whole figure.
   */
  part?: { fromCount: number; toCount: number } | null;
  /**
   * Fractional-index ordering key (#63, §5.3). Reads order placements by this;
   * reorder sets it between the new neighbours (no remove-and-reinsert). Optional
   * for lenient reads of pre-sortKey docs — those fall back to array order until
   * a migration/reorder backfills keys (see `order.ts`).
   */
  sortKey?: string;
  deletedAt?: number | null;
};

export type Section = {
  id: string;
  name: string;
  placements: Placement[];
  /** Fractional-index ordering key (#63, §5.3) — see {@link Placement.sortKey}. */
  sortKey?: string;
  deletedAt?: number | null;
};

export type AnnotationKind = "note" | "lesson" | "practice";

export type Anchor =
  | { type: "point"; figureRef: string; count: number; role?: Role }
  | { type: "figure"; figureRef: string }
  | {
      type: "figureType";
      figureType: FigureType;
      danceScope: DanceId | "all";
      /** WEP-0004: pin the note to one count of every matching figure. Only
       *  valid with a CONCRETE danceScope — counts don't align across dances
       *  (zAnchor enforces this; absent = the whole figure, the v1 shape). */
      count?: number;
      /** WEP-0004: narrow a timed note to one side (absent/null = both). */
      role?: Role;
    };

export type Reply = {
  id: string;
  authorId: string;
  text: string;
  createdAt: number;
  deletedAt?: number | null;
};

export type Annotation = {
  id: string;
  authorId: string;
  kind: AnnotationKind;
  text: string;
  tags: string[];
  anchors: Anchor[];
  replies: Reply[];
  createdAt: number;
  deletedAt?: number | null;
};

/**
 * A per-user account document (US-040). Holds the user's figure-FAMILY notes
 * (`figureType` anchors) — account-scoped, authored by the owner only. Hosted by
 * the same per-document DO machinery (DO name `account:<userId>`); its alarm
 * projects a content-free index row per family note to D1 (US-041).
 */
export type AccountDoc = {
  id: string;
  ownerId: string;
  annotations: Annotation[];
  customKinds?: RegistryKind[];
  /**
   * The owner's library bookmarks (§2.2/§2.7, ⟳v5): a set of figureRefs — either
   * an account-figure doc id or a catalog `global:<dance>:<figureType>` ref
   * (`globalFigureRef`, library.ts) — "added to my library" by this user. A
   * REFERENCE, never a copy: several users may hold the SAME figureRef in their
   * own `libraryFigureRefs`. This account doc is the source of truth; the D1
   * `library_entry` table (migration 0015) is its projection for list/search.
   * Optional for lenient reads of a pre-v5 account doc (defaults to `[]`).
   */
  libraryFigureRefs?: string[];
  schemaVersion: number;
  deletedAt?: number | null;
};

/** A routine document — sections → placements + routine-scoped annotations. */
export type RoutineDoc = {
  id: string;
  title: string;
  dance: DanceId;
  ownerId: string;
  forkedFromRef?: string | null;
  templateOf?: string | null;
  sections: Section[];
  annotations: Annotation[];
  customKinds?: RegistryKind[];
  schemaVersion: number;
  deletedAt?: number | null;
};

/** An opaque in-memory Automerge document handle. */
export type DocHandle<T> = T;

/** Options shared by the typed readers. */
export type ReadOptions = {
  /** Include soft-deleted entities (default: false — tombstoned entities omitted). */
  includeDeleted?: boolean;
};
