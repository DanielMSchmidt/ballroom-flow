// ─────────────────────────────────────────────────────────────────────────
// Test-only types for the Weave Steps document graph.
//
// The document-graph shapes now RE-EXPORT the real product types from
// `@weavesteps/domain` (doc-types.ts / dances.ts), so the fixtures and the product
// can no longer drift: a change to a product type flows straight into the
// factories/sample/tests. (Originally these were hand-mirrored structural copies
// because the product modules didn't exist yet — that's the M1-domain-close
// cleanup this file closes, task #11.)
//
// Only the genuinely TEST-OWNED shapes stay declared here: ones the product
// doesn't export as a domain type (AttributeKind — product `Attribute.kind` is a
// bare string), or that belong to layers not yet built (MembershipRole → worker
// permissions; AccountDoc → §2.7, no product builder yet). When those land, fold
// them in too.
//
// These intentionally avoid `any` (Biome `noExplicitAny: error`).
// ─────────────────────────────────────────────────────────────────────────

// Re-export the product document-graph types — single source of truth.
export type { DanceId } from "../dances";
export type {
  Anchor,
  Annotation,
  AnnotationKind,
  Attribute,
  DocScope,
  FigureDoc,
  FigureSource,
  FigureType,
  Placement,
  Reply,
  Role,
  RoutineDoc,
  Section,
} from "../doc-types";

// ── Genuinely test-owned (no product domain type yet) ──────────────────────

/** Standard + user-defined attribute kinds (product `Attribute.kind` is a bare
 *  string; this narrows the standard kinds for legible fixtures). */
export type AttributeKind =
  | "direction"
  | "footwork"
  | "rise"
  | "position"
  | "bodyActions"
  | "sway"
  | "turn"
  | string;

/** Per-document membership role (worker permission layer, US-020). */
export type MembershipRole = "viewer" | "commenter" | "editor";

// AccountDoc and its dependents reference the product types above.
import type { Annotation } from "../doc-types";

/** The per-user account doc holding figureType notes + variant index (PLAN §2.7).
 *  No product builder yet — test-owned until that lands. */
export interface AccountDoc {
  id: string;
  ownerId: string;
  /** account-scoped figureType annotations (cross-dance). */
  figureTypeNotes: Annotation[];
  /** ids of figure docs the user owns (variants + custom). */
  variantRefs: string[];
  schemaVersion: number;
}
