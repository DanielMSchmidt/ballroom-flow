// US-005 — Routine document schema (PLAN §2.6).
//
// A routine doc holds sections → ordered placements + routine-scoped
// annotations. Build it from a plain RoutineDoc, read it back (dropping
// tombstoned sections/placements/annotations by default), and soft-delete a
// section via a mergeable `deletedAt` flip.
import type * as A from "@automerge/automerge";
import { buildDoc, filterDeleted, materialize, mutate } from "./doc-internal";
import type { ReadOptions, RoutineDoc } from "./doc-types";
import { newId } from "./ids";

/** Build an in-memory Automerge routine doc from its logical shape. */
export function buildRoutineDoc(routine: RoutineDoc): A.Doc<RoutineDoc> {
  return buildDoc(routine as unknown as Record<string, unknown>) as A.Doc<RoutineDoc>;
}

/**
 * Read a routine doc as a plain POJO. By default tombstoned sections,
 * placements, and annotations are omitted at every grain; pass
 * `includeDeleted` to see them (e.g. to inspect a `deletedAt`).
 */
export function readRoutine(doc: A.Doc<RoutineDoc>, opts?: ReadOptions): RoutineDoc {
  const plain = materialize(doc);
  const sections = filterDeleted(plain.sections, opts).map((section) => ({
    ...section,
    placements: filterDeleted(section.placements, opts),
  }));
  return {
    ...plain,
    sections,
    annotations: filterDeleted(plain.annotations, opts),
  };
}

/** Append a section to a routine doc (used by US-026; handy for tests too). */
export function addSection(doc: A.Doc<RoutineDoc>, section: { name: string }): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    draft.sections.push({
      id: newId(),
      name: section.name,
      placements: [],
      deletedAt: null,
    });
  });
}

/** Soft-delete a section: set its `deletedAt` tombstone (never a hard removal). */
export function softDeleteSection(doc: A.Doc<RoutineDoc>, sectionId: string): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    const section = draft.sections.find((s) => s.id === sectionId);
    if (section) section.deletedAt = Date.now();
  });
}
