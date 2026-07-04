// US-005 — Routine document schema (PLAN §2.6).
//
// A routine doc holds sections → ordered placements + routine-scoped
// annotations. Build it from a plain RoutineDoc, read it back (dropping
// tombstoned sections/placements/annotations by default), and soft-delete a
// section via a mergeable `deletedAt` flip.
import type * as A from "@automerge/automerge";
import { buildDoc, filterDeleted, materialize, mutate } from "./doc-internal";
import type { Anchor, AnnotationKind, ReadOptions, RoutineDoc } from "./doc-types";
import { newId } from "./ids";
import { ensureSortKeys, keyBetween, sortByOrder } from "./order";

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
  // Order by sortKey (#63, §5.3): sections, and placements within each section.
  // `sortByOrder` falls back to array order for any pre-sortKey list.
  const sections = sortByOrder(filterDeleted(plain.sections, opts)).map((section) => ({
    ...section,
    placements: sortByOrder(filterDeleted(section.placements, opts)),
  }));
  return {
    ...plain,
    sections,
    annotations: filterDeleted(plain.annotations, opts).map((annotation) => ({
      ...annotation,
      replies: filterDeleted(annotation.replies, opts),
    })),
    customKinds: plain.customKinds ?? [],
  };
}

/** Append a section to a routine doc (used by US-026; handy for tests too). */
export function addSection(doc: A.Doc<RoutineDoc>, section: { name: string }): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    // Append after the last section in sortKey order (#63). Backfill any legacy
    // keyless sections first so the new key sorts correctly relative to them.
    ensureSortKeys(draft.sections);
    const lastKey = lastSortKey(draft.sections);
    draft.sections.push({
      id: newId(),
      name: section.name,
      placements: [],
      sortKey: keyBetween(lastKey, null),
      deletedAt: null,
    });
  });
}

/** The greatest sortKey among `items` (in sort order), or null if none have one. */
function lastSortKey(items: ReadonlyArray<{ sortKey?: string }>): string | null {
  let max: string | null = null;
  for (const it of items) {
    if (typeof it.sortKey === "string" && (max === null || it.sortKey > max)) max = it.sortKey;
  }
  return max;
}

/** Soft-delete a section: set its `deletedAt` tombstone (never a hard removal). */
export function softDeleteSection(doc: A.Doc<RoutineDoc>, sectionId: string): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    const section = draft.sections.find((s) => s.id === sectionId);
    if (section) section.deletedAt = Date.now();
  });
}

/**
 * Add a routine-scoped annotation (US-039): a kinded note/lesson/practice
 * anchored to a point or figure, visible to all members of the routine (it
 * lives in the routine doc, so it syncs over the existing DO/WS path).
 */
export function addAnnotation(
  doc: A.Doc<RoutineDoc>,
  input: {
    authorId: string;
    kind: AnnotationKind;
    text: string;
    anchors: Anchor[];
    tags?: string[];
  },
): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    draft.annotations.push({
      id: newId(),
      authorId: input.authorId,
      kind: input.kind,
      text: input.text,
      tags: input.tags ?? [],
      anchors: input.anchors,
      replies: [],
      createdAt: Date.now(),
      deletedAt: null,
    });
  });
}

/** Append a reply to an annotation's ordered thread (US-039). */
export function addReply(
  doc: A.Doc<RoutineDoc>,
  annotationId: string,
  input: { authorId: string; text: string },
): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    const annotation = draft.annotations.find((a) => a.id === annotationId);
    if (annotation)
      annotation.replies.push({
        id: newId(),
        authorId: input.authorId,
        text: input.text,
        createdAt: Date.now(),
        deletedAt: null,
      });
  });
}

/** Soft-delete an annotation: tombstone flip, never a hard removal (US-039). */
export function softDeleteAnnotation(
  doc: A.Doc<RoutineDoc>,
  annotationId: string,
): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    const annotation = draft.annotations.find((a) => a.id === annotationId);
    if (annotation) annotation.deletedAt = Date.now();
  });
}

/** Soft-delete a reply: tombstone flip; delete is author-only (enforced in the UI). */
export function softDeleteReply(
  doc: A.Doc<RoutineDoc>,
  annotationId: string,
  replyId: string,
): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    const reply = draft.annotations
      .find((a) => a.id === annotationId)
      ?.replies.find((r) => r.id === replyId);
    if (reply) reply.deletedAt = Date.now();
  });
}
