// ─────────────────────────────────────────────────────────────────────────
// Typed shim for the NOT-YET-BUILT @weavesteps/domain M1 surface.
//
// WHY THIS EXISTS:
//   Skipped tests dynamic-import product functions that don't exist yet (M1 §9).
//   `await import("@weavesteps/domain")` would type against the real (empty)
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
import type { Doc as AmDoc } from "@automerge/automerge";
// The demo-seed contract references the REAL product return type — the builder is
// long since built, so this keeps the shim honest without re-declaring its shape.
import type { BuildDemoSeedOptions, DemoSeed } from "../demo-seed";
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

/** One entry in a routine's ordered beat stream (US-004a continuous numbering).
 *  A figure carries block-local counts + its length in whole beats. */
export type RoutineBeatEntry =
  | { kind: "figure"; counts: number[]; beats?: number }
  | { kind: "break"; beats: number };

/** A numbered entry aligned 1:1 with the {@link RoutineBeatEntry} input. */
export type NumberedBeatEntry =
  | { kind: "figure"; tokens: string[] }
  | {
      kind: "break";
      beats: number;
      bars: number;
      startBeat: number;
      endBeat: number;
      span: string;
    };

/** The statically-known standard attribute kinds + a string index for custom kinds. */
export interface StandardRegistry extends Record<string, RegistryKind> {
  direction: RegistryKind;
  footwork: RegistryKind;
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
 * The M1 `@weavesteps/domain` public surface the skipped tests exercise. Each
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
  phraseCountLabel(count: number, dance: DanceId): string;
  countToPhrase(count: number, dance: DanceId): { phrase: number; countInPhrase: number };
  barsForFigure(counts: number[], dance: DanceId): number;
  defaultFigureCounts(attributes: Attribute[]): number;
  resolveFigureCounts(figure: {
    counts?: number;
    bars?: number;
    attributes: Attribute[];
    dance: DanceId;
  }): number;
  offBeatSymbol(count: number): string | null;
  numberRoutineBeats(entries: RoutineBeatEntry[], dance: DanceId): NumberedBeatEntry[];
  slowQuickTokens(counts: number[], endCount: number): string[];
  parseWdsfTiming(timing: string): number[];

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

  // ⟳v5 — live overlay variants (docs/concepts/figures.md § Variants, 2026-07-02)
  ownedBeats(variant: Pick<FigureDoc, "attributes">): Set<number>;
  resolveFigure(
    base: Pick<FigureDoc, "attributes" | "counts" | "bars">,
    variant: FigureDoc,
  ): FigureDoc;
  variantAttributesForEdit(
    base: Pick<FigureDoc, "attributes">,
    edited: Attribute[],
    opts?: { now?: number },
  ): Attribute[];
  spawnVariant(
    placement: Placement,
    globalFigure: FigureDoc,
    byUser: string,
    editedAttributes?: Attribute[],
    opts?: { now?: number },
  ): { variant: FigureDoc; placement: Placement };
  copyFigureForFork(figure: FigureDoc, byUser: string): FigureDoc;

  // US-010 undo.ts — `AmDoc<T>` is Automerge's readonly view of T, matching the
  // real exports (which operate on live docs, not detached POJOs).
  undoLastChange<T>(doc: AmDoc<T>, actorId: string): AmDoc<T>;
  redoLastChange<T>(doc: AmDoc<T>, actorId: string): AmDoc<T>;
  // US-038 AC-3 — soft "superseded" hint: did another actor build on (causally
  // depend on) my next undo target? Advisory only; undo still always proceeds.
  wasSupersededByOthers<T>(doc: AmDoc<T>, actorId: string): boolean;

  // US-011 figureType note matching (+ WEP-0004 timed-note count pinning; docs/concepts/annotations.md § Anchors)
  matchesFigureType(anchor: Anchor, figure: FigureDoc): boolean;
  figureTypeNoteCount(anchor: Anchor, figure: FigureDoc): number | null;

  // US-012 schemas.ts
  parseAttributeRead(input: unknown): Attribute;
  parseAttributeWrite(input: unknown, ctx?: { dance?: DanceId }): Attribute;
  parseAnchors(input: unknown): Anchor[] | null;

  // US-013 migration ladder
  CURRENT_SCHEMA_VERSION: number;
  migrate(doc: unknown): { schemaVersion: number } & Record<string, unknown>;
  // v5 milestone step 1 (docs/system/architecture.md § Persistence & the DO
  // lifecycle) — the DO-load-path draft-mutating counterpart
  // of `migrate`, called inside an Automerge `A.change`.
  migrateDraft(draft: Record<string, unknown>): void;

  // US-020 (re-exported permission helpers, used by the worker layer too)
  capabilitiesFor?(role: MembershipRole): { canEdit: boolean; canAnnotate: boolean };

  // US-056 demo-seed.ts — the pure staging demo dataset builder.
  buildDemoSeed(opts: BuildDemoSeedOptions): DemoSeed;
}

/**
 * Dynamically load the domain module, typed as `DomainApi`. M1 has long since
 * landed, so the real module satisfies the contract interface directly — the
 * assignment below is CHECKED by the compiler (no cast): if the domain's public
 * surface drifts from this contract, `pnpm typecheck` fails right here rather
 * than in some far-away destructure. The import stays dynamic (inside the
 * function body) so skipped suites never pay module-load cost — the
 * `importDomain()` convention from CLAUDE.md §4 is unchanged for callers.
 */
export async function importDomain(): Promise<DomainApi> {
  const mod: DomainApi = await import("@weavesteps/domain");
  return mod;
}
