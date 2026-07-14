// WEP-0002 — lazily mint a user's ACCOUNT doc as a live Durable Object.
//
// Mirrors the `ensureGlobalFigures` self-healing-seed precedent: idempotent, gated
// on the registry row's absence, seeding the DO BEFORE registering it (mint +
// project + seed-first). A user's account doc is minted on their first touch (the
// connect route's account branch, or a REST shim) — no bulk backfill.
//
// The seed inverts today's write direction: the user's existing D1 projection rows
// (`library_entry` + `figure_type_note_index`) are read ONCE to build the initial
// AccountDoc via the pure `importAccountDoc` builder (reusing the ULID noteIds so
// identities survive), after which the DO's alarm projection becomes the single D1
// writer for this account's content.

import {
  type AccountFamilyNoteRow,
  type AnnotationKind,
  type DanceId,
  importAccountDoc,
  type Role,
} from "@weavesteps/domain";
import type { Env } from "./index";

/** The synthetic, derivable docRef/DO-name for a user's account doc. */
export function accountDocRef(userId: string): string {
  return `account:${userId}`;
}

/**
 * Ensure `userId`'s account doc exists as a live DO. Idempotent:
 *  1. registry row present → fast path, one indexed PK read, done.
 *  2. else → import the user's live D1 rows into a seeded DO (under the migration
 *     actor, never a user undo target), then register it. The import is GATED on
 *     the registry row's absence, so a re-forward after a rollback never re-imports
 *     stale D1 over a newer doc.
 */
export async function ensureAccountDoc(env: Env, userId: string): Promise<void> {
  const docRef = accountDocRef(userId);
  const existing = await env.DB.prepare(
    "SELECT 1 AS one FROM document_registry WHERE docRef = ?1 LIMIT 1",
  )
    .bind(docRef)
    .first<{ one: number }>();
  if (existing) return;

  // Read the user's LIVE projection rows (tombstoned rows stay tombstoned in D1;
  // the note projection never resurrects a row absent from the doc).
  const lib = await env.DB.prepare(
    "SELECT figureRef FROM library_entry WHERE userId = ?1 AND deletedAt IS NULL",
  )
    .bind(userId)
    .all<{ figureRef: string }>();
  // D1 boundary typing: these columns were written as these unions (the generic is
  // the deserialization assertion, not an inline `as` cast).
  const notes = await env.DB.prepare(
    "SELECT noteId, kind, text, figureType, danceScope, count, role, updatedAt " +
      "FROM figure_type_note_index WHERE authorId = ?1 AND deletedAt IS NULL",
  )
    .bind(userId)
    .all<{
      noteId: string;
      kind: AnnotationKind;
      text: string;
      figureType: string;
      danceScope: DanceId | "all";
      count: number | null;
      role: Role | null;
      updatedAt: number;
    }>();

  const familyNotes: AccountFamilyNoteRow[] = (notes.results ?? []).map((r) => ({
    noteId: r.noteId,
    kind: r.kind,
    text: r.text,
    figureType: r.figureType,
    danceScope: r.danceScope,
    count: r.count,
    role: r.role,
    createdAt: r.updatedAt, // v1 index tracks only updatedAt; use it as createdAt.
  }));
  const account = importAccountDoc({
    userId,
    libraryFigureRefs: (lib.results ?? []).map((r) => r.figureRef),
    familyNotes,
  });

  // Seed-first, then register (the ensureGlobalFigures ordering): a connect that
  // races us finds real content, and setMetadata stamps doc_meta.type='account' so
  // the alarm runs projectAccountToD1. seedDoc is no-clobber, so a concurrent seed
  // is safe.
  const stub = env.DOC_DO.get(env.DOC_DO.idFromName(docRef));
  await stub.seedDoc(account);
  await stub.setMetadata({ doName: docRef, docRef, type: "account", ownerId: userId });

  // Register the doc. INSERT OR IGNORE guards a concurrent ensure that already
  // wrote the row (the registry row's presence is the import gate).
  await env.DB.prepare(
    "INSERT OR IGNORE INTO document_registry (docRef, type, ownerId, doName, updatedAt) VALUES (?1, 'account', ?2, ?1, ?3)",
  )
    .bind(docRef, userId, Date.now())
    .run();
}
