// ─────────────────────────────────────────────────────────────────────────
// Typed shim for the NOT-YET-BUILT @ballroom/domain M1 surface.
//
// WHY THIS EXISTS:
//   Skipped tests dynamic-import product functions that don't exist yet (M1 §9).
//   `await import("@ballroom/domain")` would type against the real (empty)
//   index and make every destructure a TS error — failing `pnpm -r typecheck`
//   (the CI contract-drift gate). We can't use `any` (Biome noExplicitAny:error).
//
//   So this module declares the *expected M1 API* as an interface and exposes
//   `importDomain()` returning it. Benefits:
//     • the skipped suite type-checks GREEN today;
//     • it doubles as a precise, reviewable spec of the M1 domain exports
//       implementers must provide for RED→GREEN.
//
//   When M1 lands, implementers can delete this shim and switch the tests to a
//   direct `import` (the real types will then match), OR keep it as the typed
//   contract. The runtime call still loads the real module — so once the
//   exports exist and the tests are unskipped, they exercise real code.
//
// Types reference the TEST-OWNED structural shapes (./types) — see that file's
// header for why those are test-owned rather than imported from product code.
// ─────────────────────────────────────────────────────────────────────────
import type {
  Anchor,
  Attribute,
  DanceId,
  FigureDoc,
  MembershipRole,
  Placement,
  RoutineDoc,
} from "./types";

/** A merged attribute-registry kind descriptor (US-003). */
export interface RegistryKind {
  kind: string;
  label: string;
  color: string;
  cardinality: "single" | "multi";
  valueType: string;
  values?: string[];
  /** When true, `values` are suggestions (free text also valid) — e.g. footwork. */
  freeText?: boolean;
  /** Whether the editor offers a free-text input (defaults to `freeText`). */
  freeTextInput?: boolean;
  appliesToDances?: DanceId[];
  /** Registry-derived info-sheet + Profile affordances (T5). */
  description?: string;
  valueDefs?: Record<string, string>;
  roleAware?: boolean;
  required?: boolean;
  builtin: boolean;
}

/** The statically-known standard attribute kinds + a string index for custom kinds. */
export interface StandardRegistry extends Record<string, RegistryKind> {
  direction: RegistryKind;
  footwork: RegistryKind;
  footPosition: RegistryKind;
  rise: RegistryKind;
  position: RegistryKind;
  bodyActions: RegistryKind;
  sway: RegistryKind;
  turn: RegistryKind;
}

/** Dance metadata (US-002). */
export interface DanceMeta {
  timeSignature: string;
  beatsPerBar: number;
  phraseBeats: number;
  travelling: boolean;
}

/** Opaque in-memory Automerge document handle (the product builders return these). */
export type DocHandle = unknown;

/**
 * The M1 `@ballroom/domain` public surface the skipped tests exercise. Each
 * member maps to a §9 M1 deliverable / a US acceptance criterion. Implementers:
 * this is the contract — satisfy it and unskip the tests.
 */
export interface DomainApi {
  // US-001 ids.ts
  newId(): string;

  // US-002 dances.ts
  DANCES: Record<DanceId, DanceMeta>;

  // US-003 vocabulary.ts — standard kinds are statically known (always present);
  // a string index covers user-defined kinds (US-043). We name the standard
  // kinds so tests can read e.g. `ATTRIBUTE_REGISTRY.step.values` without a
  // noUncheckedIndexedAccess `| undefined`.
  ATTRIBUTE_REGISTRY: StandardRegistry;
  mergeRegistry(
    base: StandardRegistry,
    custom: RegistryKind[],
  ): StandardRegistry & Record<string, RegistryKind>;
  normalizeValue(kind: string, value: string): string;

  // US-004 timing.ts
  countLabel(count: number): string;
  countToPhrase(count: number, dance: DanceId): { phrase: number; countInPhrase: number };
  barsForFigure(counts: number[], dance: DanceId): number;

  // US-005 doc-routine.ts / doc-figure.ts
  buildRoutineDoc(routine: RoutineDoc): DocHandle;
  readRoutine(doc: DocHandle, opts?: { includeDeleted?: boolean }): RoutineDoc;
  buildFigureDoc(figure: FigureDoc): DocHandle;
  readFigure(doc: DocHandle, opts?: { includeDeleted?: boolean }): FigureDoc;
  softDeleteSection(doc: DocHandle, sectionId: string): DocHandle;
  softDeleteAttribute(doc: DocHandle, attributeId: string): DocHandle;
  addSection(doc: DocHandle, section: { name: string }): DocHandle;

  // US-007 / US-008 fork.ts
  cloneRoutine(doc: DocHandle, opts: { byUser: string }): DocHandle;
  copyOnWrite(
    placement: Placement,
    sharedFigure: FigureDoc,
    byUser: string,
  ): { variant: FigureDoc | null; placement: Placement };

  // US-010 undo.ts
  undoLastChange<T>(doc: T, actorId: string): T;
  redoLastChange<T>(doc: T, actorId: string): T;
  // US-038 AC-3 — soft "superseded" hint: did another actor build on (causally
  // depend on) my next undo target? Advisory only; undo still always proceeds.
  wasSupersededByOthers<T>(doc: T, actorId: string): boolean;

  // US-011 figureType note matching
  matchesFigureType(anchor: Anchor, figure: FigureDoc): boolean;

  // US-012 schemas.ts
  parseAttributeRead(input: unknown): Attribute;
  parseAttributeWrite(input: unknown, ctx?: { dance?: DanceId }): Attribute;

  // US-013 migration ladder
  CURRENT_SCHEMA_VERSION: number;
  migrate(doc: unknown): { schemaVersion: number } & Record<string, unknown>;

  // US-020 (re-exported permission helpers, used by the worker layer too)
  capabilitiesFor?(role: MembershipRole): { canEdit: boolean; canAnnotate: boolean };
}

const DOMAIN_PKG = "@ballroom/domain";

/**
 * Dynamically load the M1 domain module, typed as `DomainApi`. The specifier is
 * a runtime variable so the type-checker uses the `DomainApi` cast (below)
 * rather than resolving the real — currently empty — module shape. Replace with
 * a direct typed import once M1 exports exist.
 */
export async function importDomain(): Promise<DomainApi> {
  const mod = (await import(DOMAIN_PKG)) as unknown as DomainApi;
  return mod;
}
