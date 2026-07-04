// US-005 — Figure document schema (PLAN §2.2–2.5).
//
// A figure doc carries its metadata (scope/ownerId/figureType/dance/name/source,
// optional alignment), a float-count attribute timeline, an optional
// `baseFigureRef` provenance pointer (a frozen copy carries its own attributes —
// no overlay), and a schemaVersion. Build it from a plain FigureDoc, read it
// back (dropping tombstoned attributes by default), and soft-delete an attribute
// via a mergeable `deletedAt` flip.
import type * as A from "@automerge/automerge";
import { buildDoc, filterDeleted, materialize, mutate } from "./doc-internal";
import type { FigureDoc, ReadOptions } from "./doc-types";

/** Build an in-memory Automerge figure doc from its logical shape. */
export function buildFigureDoc(figure: FigureDoc): A.Doc<FigureDoc> {
  return buildDoc(figure as unknown as Record<string, unknown>) as A.Doc<FigureDoc>;
}

/**
 * Read a figure doc as a plain POJO. Tombstoned attributes are omitted by
 * default; pass `includeDeleted` to retain them.
 */
export function readFigure(doc: A.Doc<FigureDoc>, opts?: ReadOptions): FigureDoc {
  const plain = materialize(doc);
  return {
    ...plain,
    attributes: filterDeleted(plain.attributes, opts),
  };
}

/** Soft-delete an attribute: set its `deletedAt` tombstone (never a hard removal). */
export function softDeleteAttribute(doc: A.Doc<FigureDoc>, attributeId: string): A.Doc<FigureDoc> {
  return mutate(doc, (draft) => {
    const attr = draft.attributes.find((a) => a.id === attributeId);
    if (attr) attr.deletedAt = Date.now();
  });
}
