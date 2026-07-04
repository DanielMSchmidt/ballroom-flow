// ─────────────────────────────────────────────────────────────────────────
// Pure domain factories / builders (PLAN.md §10.3 "pure factories").
//
// These build the plain logical shapes of the document graph (types.ts) for
// use as test inputs and as the expected/asserted shape. They are POJO
// builders only — they do NOT touch Automerge (so importing them never loads
// the WASM and never needs the real product schemas). The skipped test bodies
// feed these POJOs into the real `doc-routine` / `doc-figure` builders via
// dynamic import when those modules exist.
//
// Every id defaults to a deterministic, readable string so failing assertions
// are legible; pass a real ULID where monotonicity matters (US-001 tests do).
// ─────────────────────────────────────────────────────────────────────────
import type {
  Alignment,
  Anchor,
  Annotation,
  AnnotationKind,
  Attribute,
  AttributeKind,
  DanceId,
  FigureDoc,
  FigureType,
  Placement,
  Role,
  RoutineDoc,
  Section,
} from "./types";

let counter = 0;
/** Deterministic readable id for fixtures (NOT a ULID — US-001 uses real ULIDs). */
export function testId(prefix = "id"): string {
  counter += 1;
  return `${prefix}_${counter.toString().padStart(4, "0")}`;
}

/** Reset the fixture id counter so a suite gets stable ids (call in beforeEach). */
export function resetTestIds(): void {
  counter = 0;
}

export function makeAttribute(overrides: Partial<Attribute> = {}): Attribute {
  return {
    id: overrides.id ?? testId("attr"),
    kind: overrides.kind ?? ("footwork" as AttributeKind),
    count: overrides.count ?? 1,
    role: overrides.role ?? null,
    value: "value" in overrides ? overrides.value : "HT",
    deletedAt: overrides.deletedAt ?? null,
  };
}

export function makeAlignment(overrides: Partial<Alignment> = {}): Alignment {
  return {
    qualifier: overrides.qualifier ?? "facing",
    direction: overrides.direction ?? "LOD",
  };
}

/** A global-library figure doc (app-owned, not a copy). */
export function makeFigureDoc(overrides: Partial<FigureDoc> = {}): FigureDoc {
  return {
    id: overrides.id ?? testId("fig"),
    scope: overrides.scope ?? "global",
    ownerId: overrides.ownerId ?? "app",
    figureType: overrides.figureType ?? "feather",
    dance: overrides.dance ?? "foxtrot",
    name: overrides.name ?? "Feather",
    source: overrides.source ?? "library",
    entryAlignment: overrides.entryAlignment,
    exitAlignment: overrides.exitAlignment,
    attributes: overrides.attributes ?? [
      makeAttribute({ kind: "footwork", count: 1, value: "HT" }),
      makeAttribute({ kind: "footwork", count: 2, value: "T" }),
      makeAttribute({ kind: "footwork", count: 3, value: "TH" }),
    ],
    baseFigureRef: overrides.baseFigureRef ?? null,
    schemaVersion: overrides.schemaVersion ?? 1,
    deletedAt: overrides.deletedAt ?? null,
  };
}

/**
 * An account-scoped frozen-copy figure doc: it carries its OWN attributes (no
 * overlay) with `baseFigureRef` as provenance only (§5.2, §2.5.1 #14–18). Pass
 * `attributes` in `overrides` for the copy's content; defaults to the global
 * library template's attributes.
 */
export function makeVariantDoc(
  baseFigureRef: string,
  byUser: string,
  overrides: Partial<FigureDoc> = {},
): FigureDoc {
  return makeFigureDoc({
    scope: "account",
    ownerId: byUser,
    source: "custom",
    baseFigureRef,
    ...overrides,
  });
}

export function makePlacement(figureRef: string, overrides: Partial<Placement> = {}): Placement {
  return {
    id: overrides.id ?? testId("plc"),
    figureRef,
    perPlacementAlignment: overrides.perPlacementAlignment,
    deletedAt: overrides.deletedAt ?? null,
  };
}

export function makeSection(overrides: Partial<Section> = {}): Section {
  return {
    id: overrides.id ?? testId("sec"),
    name: overrides.name ?? "Intro",
    placements: overrides.placements ?? [],
    deletedAt: overrides.deletedAt ?? null,
  };
}

export function makeAnchor(overrides: Partial<Extract<Anchor, { type: "point" }>> = {}): Anchor {
  return {
    type: "point",
    figureRef: overrides.figureRef ?? testId("fig"),
    count: overrides.count ?? 1,
    role: overrides.role ?? null,
  };
}

export function makeFigureTypeAnchor(figureType: FigureType, danceScope: DanceId | "all"): Anchor {
  return { type: "figureType", figureType, danceScope };
}

export function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: overrides.id ?? testId("ann"),
    authorId: overrides.authorId ?? "user_author",
    kind: overrides.kind ?? ("note" as AnnotationKind),
    text: overrides.text ?? "keep the head left",
    tags: overrides.tags ?? [],
    anchors: overrides.anchors ?? [makeAnchor()],
    replies: overrides.replies ?? [],
    createdAt: overrides.createdAt ?? 0,
    deletedAt: overrides.deletedAt ?? null,
  };
}

export function makeRoutineDoc(overrides: Partial<RoutineDoc> = {}): RoutineDoc {
  return {
    id: overrides.id ?? testId("rt"),
    title: overrides.title ?? "My Foxtrot",
    dance: overrides.dance ?? "foxtrot",
    ownerId: overrides.ownerId ?? "user_owner",
    forkedFromRef: overrides.forkedFromRef ?? null,
    templateOf: overrides.templateOf ?? null,
    sections: overrides.sections ?? [makeSection()],
    annotations: overrides.annotations ?? [],
    customKinds: overrides.customKinds ?? [],
    schemaVersion: overrides.schemaVersion ?? 1,
    deletedAt: overrides.deletedAt ?? null,
  };
}

/** Convenience: build a point anchor's role-typed variant (helper for US-039). */
export function pointAnchor(figureRef: string, count: number, role: Role = null): Anchor {
  return { type: "point", figureRef, count, role };
}
