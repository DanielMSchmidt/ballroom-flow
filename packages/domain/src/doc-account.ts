// US-040 — account document: figure-FAMILY notes + family-note resolution.
// ⟳v5 (§2.2/§2.7/§4.2/§5.2, D28) — also the library BOOKMARK set
// (`libraryFigureRefs` + `addLibraryRef`/`removeLibraryRef`): "add to my
// library" records a figureRef here, a REFERENCE never a copy.
//
// A `figureType` note is account-scoped (owned by one user) and anchored to a
// figure FAMILY rather than a specific figure doc, so it surfaces on every figure
// of that family across the user's routines. `resolveFamilyNotesFor` maps a set of
// figures to the family notes that apply to each, using the pure identity match in
// `figuretype.ts` — and IS the live runtime path: the worker returns family-note
// rows, the store hands them here to match against the routine's figures.
//
// STORAGE NOTE: in v1 a family note's content lives in the worker's D1 index row
// (figure_type_note_index; server-mediated — single-author reference data, no
// concurrent edit) and a library bookmark's in `library_entry` (migration 0015)
// the same way. This account-doc CRDT (buildAccountDoc + the addFamilyNote/
// addAccountReply/addLibraryRef/removeLibraryRef/softDelete… mutators) is built +
// tested as the intended home once account docs get offline/concurrent edit, but
// is NOT yet wired into a live DO. It is kept deliberately so that migration is a
// store-seam swap, not a rebuild.
//
// Whether ANOTHER user may see one of these notes (the option-2 co-membership
// gate) is the worker's concern (US-041), never this module's.
import type * as A from "@automerge/automerge";
import type { DanceId } from "./dances";
import { buildDoc, filterDeleted, materialize, mutate } from "./doc-internal";
import type { AccountDoc, Annotation, AnnotationKind, FigureDoc, ReadOptions } from "./doc-types";
import { matchesFigureType } from "./figuretype";
import { newId } from "./ids";

/** Build an in-memory Automerge account doc from its logical shape. */
export function buildAccountDoc(account: AccountDoc): A.Doc<AccountDoc> {
  return buildDoc(account as unknown as Record<string, unknown>) as A.Doc<AccountDoc>;
}

/** Read an account doc as a plain POJO; tombstoned notes/replies dropped by default. */
export function readAccount(doc: A.Doc<AccountDoc>, opts?: ReadOptions): AccountDoc {
  const plain = materialize(doc);
  return {
    ...plain,
    annotations: filterDeleted(plain.annotations, opts).map((annotation) => ({
      ...annotation,
      replies: filterDeleted(annotation.replies, opts),
    })),
    customKinds: plain.customKinds ?? [],
    // Lenient read (§2.2 ⟳v5): a pre-v5 account doc has no `libraryFigureRefs`
    // field at all — default it to [] rather than surfacing `undefined`, the same
    // forward-compat treatment `customKinds` gets above.
    libraryFigureRefs: plain.libraryFigureRefs ?? [],
  };
}

/**
 * Bookmark a figure into the owner's library (§2.2/§4.2/§5.2, ⟳v5 — "add to my
 * library"): a REFERENCE, never a copy. Idempotent: bookmarking an
 * already-present figureRef is a no-op (no duplicate entry).
 */
export function addLibraryRef(doc: A.Doc<AccountDoc>, figureRef: string): A.Doc<AccountDoc> {
  return mutate(doc, (draft) => {
    if (!draft.libraryFigureRefs) draft.libraryFigureRefs = [];
    if (!draft.libraryFigureRefs.includes(figureRef)) draft.libraryFigureRefs.push(figureRef);
  });
}

/**
 * Un-bookmark a figure (§4.2/§5.2, ⟳v5): removes the reference from the owner's
 * library set. Never touches the figure doc itself or any placement referencing
 * it — un-bookmarking drops a reference, not the shared figure. Idempotent:
 * removing an absent figureRef is a no-op.
 */
export function removeLibraryRef(doc: A.Doc<AccountDoc>, figureRef: string): A.Doc<AccountDoc> {
  return mutate(doc, (draft) => {
    if (!draft.libraryFigureRefs) return;
    const idx = draft.libraryFigureRefs.indexOf(figureRef);
    if (idx !== -1) draft.libraryFigureRefs.splice(idx, 1);
  });
}

/**
 * Add a figure-family note (US-040): a kinded note anchored to a `figureType`
 * with a dance scope (`"all"` → matches the family in any dance; a `DanceId` →
 * only that dance).
 */
export function addFamilyNote(
  doc: A.Doc<AccountDoc>,
  input: {
    authorId: string;
    kind: AnnotationKind;
    text: string;
    figureType: string;
    danceScope: DanceId | "all";
    tags?: string[];
  },
): A.Doc<AccountDoc> {
  return mutate(doc, (draft) => {
    draft.annotations.push({
      id: newId(),
      authorId: input.authorId,
      kind: input.kind,
      text: input.text,
      tags: input.tags ?? [],
      anchors: [{ type: "figureType", figureType: input.figureType, danceScope: input.danceScope }],
      replies: [],
      createdAt: Date.now(),
      deletedAt: null,
    });
  });
}

/** Append a reply to a family note's ordered thread. */
export function addAccountReply(
  doc: A.Doc<AccountDoc>,
  annotationId: string,
  input: { authorId: string; text: string },
): A.Doc<AccountDoc> {
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

/** Soft-delete a family note: tombstone flip, never a hard removal. */
export function softDeleteAccountAnnotation(
  doc: A.Doc<AccountDoc>,
  annotationId: string,
): A.Doc<AccountDoc> {
  return mutate(doc, (draft) => {
    const annotation = draft.annotations.find((a) => a.id === annotationId);
    if (annotation) annotation.deletedAt = Date.now();
  });
}

/**
 * Map each figure to the family notes that apply to it (US-040). A figure with no
 * matching note is absent from the map (never an empty array), so callers can use
 * `map.has(figureRef)` as a presence test.
 */
export function resolveFamilyNotesFor(
  figures: FigureDoc[],
  annotations: Annotation[],
): Map<string, Annotation[]> {
  const out = new Map<string, Annotation[]>();
  for (const figure of figures) {
    const matching = annotations.filter((a) =>
      a.anchors.some((anchor) => matchesFigureType(anchor, figure)),
    );
    if (matching.length > 0) out.set(figure.id, matching);
  }
  return out;
}
