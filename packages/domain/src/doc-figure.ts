// US-005 — Figure document schema (docs/concepts/figures.md, docs/concepts/notation.md).
//
// A figure doc carries its metadata (scope/ownerId/figureType/dance/name/source),
// a float-count attribute timeline, an optional
// `baseFigureRef` provenance pointer (a frozen copy carries its own attributes —
// no overlay), and a schemaVersion. Build it from a plain FigureDoc, read it
// back (dropping tombstoned attributes by default), and soft-delete an attribute
// via a mergeable `deletedAt` flip.
import type * as A from "@automerge/automerge";
import { buildDoc, filterDeleted, materialize, mutate } from "./doc-internal";
import type { FigureDoc, ReadOptions } from "./doc-types";

/** Build an in-memory Automerge figure doc from its logical shape. */
export function buildFigureDoc(figure: FigureDoc): A.Doc<FigureDoc> {
  return buildDoc(figure);
}

/**
 * Read a figure doc as a plain POJO. Tombstoned attributes are omitted by
 * default; pass `includeDeleted` to retain them.
 */
export function readFigure(doc: A.Doc<FigureDoc>, opts?: ReadOptions): FigureDoc {
  const plain = materialize(doc);
  return {
    ...plain,
    // Defensive: a figure-typed DO whose content was never seeded as a FigureDoc
    // (e.g. a `figureRef` resolving to a doc with no `attributes`) materializes
    // with `attributes === undefined` — treat it as an empty timeline rather than
    // letting `filterDeleted` throw (`Cannot read properties of undefined (reading
    // 'filter')`) and 500 the whole snapshot read. Mirrors the guard in doc-do.ts.
    attributes: filterDeleted(plain.attributes ?? [], opts),
  };
}

/** Soft-delete an attribute: set its `deletedAt` tombstone (never a hard removal). */
export function softDeleteAttribute(doc: A.Doc<FigureDoc>, attributeId: string): A.Doc<FigureDoc> {
  return mutate(doc, (draft) => {
    const attr = draft.attributes.find((a) => a.id === attributeId);
    if (attr) attr.deletedAt = Date.now();
  });
}
