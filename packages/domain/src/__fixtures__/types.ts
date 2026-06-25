// ─────────────────────────────────────────────────────────────────────────
// Test-only structural types for the Ballroom Flow document graph.
//
// WHY THESE LIVE HERE (and are not imported from product code):
//   The product modules in `@ballroom/domain` (doc-routine.ts, doc-figure.ts,
//   overlay.ts, …) DO NOT EXIST YET — they are built in Milestone 1 (PLAN.md §9
//   M1, §6.3). Skipped tests must still type-check and collect cleanly, so the
//   factories below need *some* typed shape to return. These mirror the logical
//   shapes in PLAN.md §2 (the document graph) closely enough for fixtures and
//   assertions, but they are deliberately TEST-OWNED and structural. When the
//   real schemas land, implementers can either re-point these aliases at the
//   product types or keep them as the structural contract the fixtures assert
//   against — either way the skipped test bodies (which dynamic-import the real
//   product code) are the source of truth for GREEN.
//
// These intentionally avoid `any` (Biome `noExplicitAny: error`).
// ─────────────────────────────────────────────────────────────────────────

/** The 5 Standard travelling dances (PLAN.md §3, US-002). */
export type DanceId = "waltz" | "viennese_waltz" | "quickstep" | "foxtrot" | "tango";

/** Standard + user-defined attribute kinds (PLAN.md §3, US-003). */
export type AttributeKind = "step" | "rise" | "position" | "bodyActions" | "sway" | "turn" | string;

/** leader / follower / both(null) (PLAN.md §2.5, §1.5). */
export type Role = "leader" | "follower" | null;

/** A figure-family identity that spans dances (PLAN.md §2.2, US-011). */
export type FigureType = string;

export type DocScope = "global" | "account";
export type FigureSource = "library" | "custom";
export type MembershipRole = "viewer" | "commenter" | "editor";

/** An attribute placed on a figure's float-count timeline (PLAN.md §2.5). */
export interface Attribute {
  id: string;
  kind: AttributeKind;
  /** Float count relative to figure start; fraction → e/&/a (US-004). */
  count: number;
  role?: Role;
  value: unknown;
  deletedAt?: number | null;
}

/** The overlay a variant stores instead of duplicating the base (PLAN.md §2.2). */
export interface Overlay {
  /** base attribute id → replacement value. */
  overrides: Record<string, unknown>;
  /** base attribute ids this variant drops. */
  tombstones: string[];
  /** variant-only attributes. */
  additions: Attribute[];
  /** variant display name override. */
  rename?: string | null;
}

export interface Alignment {
  qualifier: "facing" | "backing" | "pointing";
  direction: "LOD" | "ALOD" | "wall" | "centre" | "DW" | "DC" | "DW_against" | "DC_against";
}

/** A figure document — global library entry or account variant/custom (PLAN.md §2.2). */
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
  /** Set ⇒ this doc is a variant storing only an overlay against the base. */
  baseFigureRef?: string | null;
  overlay?: Overlay;
  schemaVersion: number;
  deletedAt?: number | null;
}

export interface Placement {
  id: string;
  figureRef: string;
  perPlacementAlignment?: Alignment;
  deletedAt?: number | null;
}

export interface Section {
  id: string;
  name: string;
  placements: Placement[];
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
  schemaVersion: number;
  deletedAt?: number | null;
}

/** The per-user account doc holding figureType notes + variant index (PLAN.md §2.7). */
export interface AccountDoc {
  id: string;
  ownerId: string;
  /** account-scoped figureType annotations (cross-dance). */
  figureTypeNotes: Annotation[];
  /** ids of figure docs the user owns (variants + custom). */
  variantRefs: string[];
  schemaVersion: number;
}
