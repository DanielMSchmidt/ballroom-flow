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
// STORAGE NOTE (as-built, WEP-0002 (docs/system/architecture.md § D1 — the index
// & projections) — 2026-07-15): the account doc IS now wired to
// a live per-user Durable Object (`account:<userId>`). This CRDT — buildAccountDoc
// + the addFamilyNote/addAccountReply/addLibraryRef/removeLibraryRef/softDelete…
// mutators — is the LIVE WRITE PATH: family notes and library bookmarks are edits
// to that doc (offline-capable + undoable via the §11.2 machinery). The D1 tables
// `figure_type_note_index` (family-note content) and `library_entry` (bookmarks,
// migration 0015) are now ALARM-WRITTEN PROJECTIONS of this doc — non-destructive,
// idempotent, tombstone-aware — so D1 is a pure index again (rows re-derivable from
// the doc), exactly like journal_entry. `importAccountDoc` (below) builds the doc
// from those rows on first touch (reusing each ULID noteId so identities survive).
//
// Whether ANOTHER user may see one of these notes (the option-2 co-membership
// gate) is the worker's concern (US-041), never this module's.
import type * as A from "@automerge/automerge";
import type { DanceId } from "./dances";
import { buildDoc, filterDeleted, materialize, mutate } from "./doc-internal";
import type {
  AccountDoc,
  Annotation,
  AnnotationKind,
  FigureDoc,
  ReadOptions,
  Role,
} from "./doc-types";
import { matchesFigureType } from "./figuretype";
import { newId } from "./ids";
import { CURRENT_SCHEMA_VERSION } from "./migrations";

/** Build an in-memory Automerge account doc from its logical shape. */
export function buildAccountDoc(account: AccountDoc): A.Doc<AccountDoc> {
  return buildDoc(account);
}

/** One persisted `figure_type_note_index` row, projected back to import an account doc. */
export type AccountFamilyNoteRow = {
  /** The ULID `noteId` — REUSED as the annotation id so identities survive the import. */
  noteId: string;
  kind: AnnotationKind;
  text: string;
  figureType: string;
  danceScope: DanceId | "all";
  /** WEP-0004 (docs/concepts/annotations.md § Anchors) timed-note fields (migration 0018): carried so a timed family note
   *  survives the import instead of flattening to the untimed v1 shape. */
  count?: number | null;
  role?: Role | null;
  /** The row's timestamp (v1 index tracks only `updatedAt`); carried so the build is deterministic. */
  createdAt: number;
  /** Tombstone carried through faithfully — a deleted row imports as a tombstoned annotation. */
  deletedAt?: number | null;
};

/** The user's live D1 rows that seed a first `ensureAccountDoc` import (WEP-0002; docs/system/architecture.md § D1 — the index & projections). */
export type AccountImportRows = {
  userId: string;
  /** Live `library_entry` refs (caller pre-filters `deletedAt IS NULL`); deduped, order preserved. */
  libraryFigureRefs: string[];
  /** `figure_type_note_index` rows authored by the user (tombstoned rows may be included). */
  familyNotes: AccountFamilyNoteRow[];
};

/**
 * Build the initial `AccountDoc` for `ensureAccountDoc` from a user's existing D1
 * projection rows (WEP-0002; docs/system/architecture.md § D1 — the index & projections). PURE and DETERMINISTIC — no `Date.now()`, no ULID
 * minting: family-note `noteId`s are REUSED as annotation ids so identities survive
 * the D1→doc inversion, and timestamps come from the rows. Tombstone-safe: a
 * tombstoned row imports as a tombstoned annotation (never dropped, never
 * hard-removed), so the alarm can project it back faithfully. Stamps
 * `CURRENT_SCHEMA_VERSION`.
 */
export function importAccountDoc(rows: AccountImportRows): AccountDoc {
  const seenRefs = new Set<string>();
  const libraryFigureRefs: string[] = [];
  for (const ref of rows.libraryFigureRefs) {
    if (!seenRefs.has(ref)) {
      seenRefs.add(ref);
      libraryFigureRefs.push(ref);
    }
  }
  const annotations: Annotation[] = rows.familyNotes.map((row) => ({
    id: row.noteId, // REUSED — identity survives the D1→doc inversion.
    authorId: rows.userId,
    kind: row.kind,
    text: row.text,
    tags: [],
    anchors: [
      {
        type: "figureType",
        figureType: row.figureType,
        danceScope: row.danceScope,
        // Only include the timed fields when present — Automerge can't store
        // `undefined`, and their absence IS the untimed whole-figure shape.
        ...(row.count != null ? { count: row.count } : {}),
        ...(row.role != null ? { role: row.role } : {}),
      },
    ],
    replies: [],
    createdAt: row.createdAt,
    deletedAt: row.deletedAt ?? null,
  }));
  return {
    id: `account:${rows.userId}`,
    ownerId: rows.userId,
    annotations,
    libraryFigureRefs,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deletedAt: null,
  };
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
    /** WEP-0004 (docs/concepts/annotations.md § Anchors) timed note: pin to one count (+ optional role lens) of every
     *  matching figure. Only valid with a concrete danceScope (counts don't
     *  align across dances); absent = the whole figure, the v1 shape. */
    count?: number;
    role?: Role;
  },
): A.Doc<AccountDoc> {
  return mutate(doc, (draft) => {
    draft.annotations.push({
      id: newId(),
      authorId: input.authorId,
      kind: input.kind,
      text: input.text,
      tags: input.tags ?? [],
      anchors: [
        {
          type: "figureType",
          figureType: input.figureType,
          danceScope: input.danceScope,
          ...(input.count != null ? { count: input.count } : {}),
          ...(input.role != null ? { role: input.role } : {}),
        },
      ],
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
