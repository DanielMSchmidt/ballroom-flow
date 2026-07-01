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
import type { DanceId } from "./dances";
import type { RegistryKind } from "./vocabulary";

/** leader / follower / both (null). */
export type Role = "leader" | "follower" | null;
/** A figure-family identity that spans dances (US-011). */
export type FigureType = string;
export type DocScope = "global" | "account";
export type FigureSource = "library" | "custom";

/** An attribute placed on a figure's float-count timeline (§2.5). */
export interface Attribute {
  id: string;
  kind: string;
  /** Float count relative to figure start; fraction → e/&/a (US-004). */
  count: number;
  role?: Role;
  value: unknown;
  deletedAt?: number | null;
}

export interface Alignment {
  qualifier: "facing" | "backing" | "pointing";
  direction: "LOD" | "ALOD" | "wall" | "centre" | "DW" | "DC" | "DW_against" | "DC_against";
}

/** A figure document — global library entry or account variant/custom (§2.2). */
export interface FigureDoc {
  id: string;
  scope: DocScope;
  ownerId: string;
  figureType: FigureType;
  dance: DanceId;
  name: string;
  source: FigureSource;
  entryAlignment?: Alignment;
  exitAlignment?: Alignment;
  attributes: Attribute[];
  /**
   * Provenance only (§2.2, §5.2): the figure this doc was copied from, for
   * lineage display and the "custom" badge. NOT resolved live — a copy is a
   * frozen snapshot carrying its own `attributes`.
   */
  baseFigureRef?: string | null;
  schemaVersion: number;
  deletedAt?: number | null;
}

export interface Placement {
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
  perPlacementAlignment?: Alignment;
  /**
   * Fractional-index ordering key (#63, §5.3). Reads order placements by this;
   * reorder sets it between the new neighbours (no remove-and-reinsert). Optional
   * for lenient reads of pre-sortKey docs — those fall back to array order until
   * a migration/reorder backfills keys (see `order.ts`).
   */
  sortKey?: string;
  deletedAt?: number | null;
}

export interface Section {
  id: string;
  name: string;
  placements: Placement[];
  /** Fractional-index ordering key (#63, §5.3) — see {@link Placement.sortKey}. */
  sortKey?: string;
  deletedAt?: number | null;
}

export type AnnotationKind = "note" | "lesson" | "practice";

export type Anchor =
  | { type: "point"; figureRef: string; count: number; role?: Role }
  | { type: "figure"; figureRef: string }
  | { type: "figureType"; figureType: FigureType; danceScope: DanceId | "all" };

export interface Reply {
  id: string;
  authorId: string;
  text: string;
  createdAt: number;
  deletedAt?: number | null;
}

export interface Annotation {
  id: string;
  authorId: string;
  kind: AnnotationKind;
  text: string;
  tags: string[];
  anchors: Anchor[];
  replies: Reply[];
  createdAt: number;
  deletedAt?: number | null;
}

/**
 * A per-user account document (US-040). Holds the user's figure-FAMILY notes
 * (`figureType` anchors) — account-scoped, authored by the owner only. Hosted by
 * the same per-document DO machinery (DO name `account:<userId>`); its alarm
 * projects a content-free index row per family note to D1 (US-041).
 */
export interface AccountDoc {
  id: string;
  ownerId: string;
  annotations: Annotation[];
  customKinds?: RegistryKind[];
  schemaVersion: number;
  deletedAt?: number | null;
}

/** A routine document — sections → placements + routine-scoped annotations. */
export interface RoutineDoc {
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
}

/** An opaque in-memory Automerge document handle. */
export type DocHandle<T> = T;

/** Options shared by the typed readers. */
export interface ReadOptions {
  /** Include soft-deleted entities (default: false — tombstoned entities omitted). */
  includeDeleted?: boolean;
}
