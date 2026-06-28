// US-022/US-025 — routine create + quota lookups against the D1 index.
//
// D1 is the source of truth for the owned-routine count (quota) and the list.
// Create EAGER-projects the registry row (+ the owner membership row) so the
// count/list see a new routine immediately (#129) — edits stay alarm-projected.

/**
 * Free-plan owned-routine cap — the ONE authoritative source. Imported by
 * fork.ts and index.ts so the constant is never duplicated (#176).
 */
export const FREE_ROUTINE_CAP = 3;

import type { RoutineListItem } from "@ballroom/contract";
import type { DanceId } from "@ballroom/domain";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { documentRegistry, membership } from "./schema";

/**
 * How many routines the user OWNS (not shared-in): the quota count. Counts
 * `document_registry` rows owned by the user, of type routine, not soft-deleted
 * — exactly the predicate the EXPLAIN-no-SCAN gate checks, served by
 * `document_registry_owner_idx` (ownerId, type, deletedAt, …).
 */
export async function countOwnedRoutines(db: D1Database, userId: string): Promise<number> {
  const row = await drizzle(db)
    .select({ n: count() })
    .from(documentRegistry)
    .where(
      and(
        eq(documentRegistry.ownerId, userId),
        eq(documentRegistry.type, "routine"),
        isNull(documentRegistry.deletedAt),
      ),
    )
    .get();
  return row?.n ?? 0;
}

/**
 * How many routines the user can EDIT: the ones they OWN plus the ones SHARED IN
 * to them as an active EDITOR (commenter/viewer access is uncapped). Distinct
 * docRefs, type routine, not soft-deleted. Two indexed reads (owned via
 * document_registry_owner_idx; editor-shared via membership_user_idx → the
 * registry PK), deduped in memory — an owner also carries an editor membership
 * row on their own routine, so the dedup prevents double-counting.
 *
 * Drives the invite-accept downgrade (US-022 × US-023): an editor invite that
 * would push the redeemer past their cap is granted as commenter instead. The
 * CREATE/fork quota intentionally stays owned-only (countOwnedRoutines).
 */
export async function countEditableRoutines(db: D1Database, userId: string): Promise<number> {
  const d = drizzle(db);
  const owned = await d
    .select({ docRef: documentRegistry.docRef })
    .from(documentRegistry)
    .where(
      and(
        eq(documentRegistry.ownerId, userId),
        eq(documentRegistry.type, "routine"),
        isNull(documentRegistry.deletedAt),
      ),
    )
    .all();
  const editorShared = await d
    .select({ docRef: membership.docRef })
    .from(membership)
    .innerJoin(documentRegistry, eq(documentRegistry.docRef, membership.docRef))
    .where(
      and(
        eq(membership.userId, userId),
        eq(membership.role, "editor"),
        isNull(membership.deletedAt),
        eq(documentRegistry.type, "routine"),
        isNull(documentRegistry.deletedAt),
      ),
    )
    .all();
  const distinct = new Set<string>();
  for (const r of owned) distinct.add(r.docRef);
  for (const r of editorShared) distinct.add(r.docRef);
  return distinct.size;
}

/**
 * The viewer's routines for the Choreo list (US-025): the ones they OWN plus the
 * ones SHARED IN to them, newest first. Two indexed reads (owned via
 * document_registry_owner_idx; shared via membership_user_idx + the registry PK)
 * merged in memory — owner wins on overlap. D1 is a pure index, so this never
 * reads CRDT content; create eager-projects (US-022) so a new routine is here
 * immediately, while edit metadata is alarm-projected and may lag (#126).
 */
export async function listRoutines(db: D1Database, userId: string): Promise<RoutineListItem[]> {
  const d = drizzle(db);

  const owned = await d
    .select({
      docRef: documentRegistry.docRef,
      title: documentRegistry.title,
      dance: documentRegistry.dance,
      updatedAt: documentRegistry.updatedAt,
    })
    .from(documentRegistry)
    .where(
      and(
        eq(documentRegistry.ownerId, userId),
        eq(documentRegistry.type, "routine"),
        isNull(documentRegistry.deletedAt),
      ),
    )
    .orderBy(desc(documentRegistry.updatedAt))
    .all();

  const shared = await d
    .select({
      docRef: documentRegistry.docRef,
      title: documentRegistry.title,
      dance: documentRegistry.dance,
      updatedAt: documentRegistry.updatedAt,
      role: membership.role,
    })
    .from(membership)
    .innerJoin(documentRegistry, eq(documentRegistry.docRef, membership.docRef))
    .where(
      and(
        eq(membership.userId, userId),
        isNull(membership.deletedAt),
        eq(documentRegistry.type, "routine"),
        isNull(documentRegistry.deletedAt),
      ),
    )
    .all();

  const seen = new Set<string>();
  const items: RoutineListItem[] = [];
  const push = (
    row: { docRef: string; title: string | null; dance: string | null; updatedAt: number },
    role: RoutineListItem["role"],
  ): void => {
    if (seen.has(row.docRef)) return; // owner wins over a redundant membership row
    seen.add(row.docRef);
    items.push({
      docRef: row.docRef,
      title: row.title ?? "Untitled routine",
      dance: (row.dance ?? "waltz") as DanceId,
      role,
      updatedAt: row.updatedAt,
    });
  };
  for (const r of owned) push(r, "owner");
  for (const r of shared) push(r, r.role);
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The exact SQL `searchReachable` runs (US-046). Exported so the EXPLAIN-gate
 * test asserts the REAL query (no drift). Scoped to owned docs + app-owned
 * globals via `(ownerId = ?1 OR ownerId = 'app')` — the planner serves each
 * branch from an index (owner_idx + title_idx COLLATE NOCASE), no full SCAN.
 * `withDance` appends the optional `AND dance = ?3` filter.
 */
export function buildSearchSql(withDance: boolean): string {
  return (
    "SELECT docRef, type, ownerId, title, dance FROM document_registry " +
    "WHERE deletedAt IS NULL AND title LIKE ?2 AND (ownerId = ?1 OR ownerId = 'app')" +
    (withDance ? " AND dance = ?3" : "") +
    " ORDER BY updatedAt DESC LIMIT 50"
  );
}

/** Prefix search over the caller's reachable docs (US-046). Indexed: routines by
 *  owner (owner_idx), figures by owner IN (user,'app') (title_idx COLLATE NOCASE).
 *  NOTE: shared-in routines (membership, not ownership) are out of v1 search scope
 *  to keep the query single-index; add a UNION over membership_user_idx in v1.1. */
export async function searchReachable(
  db: D1Database,
  { userId, q, dance }: { userId: string; q: string; dance?: string },
): Promise<
  { docRef: string; type: string; ownerId: string; title: string; dance: string | null }[]
> {
  const prefix = `${q}%`;
  const params = dance ? [userId, prefix, dance] : [userId, prefix];
  // Owned routines + figures the user owns or that are app-owned globals.
  const rows = await db
    .prepare(buildSearchSql(Boolean(dance)))
    .bind(...params)
    .all<{ docRef: string; type: string; ownerId: string; title: string; dance: string | null }>();
  return rows.results;
}

/**
 * App-owned sample/template routines (US-045). Indexed by document_registry_owner_idx
 * (ownerId='app') — no SCAN. Returns the registry rows for all app-owned routines,
 * which the `/api/templates` route exposes to authenticated users.
 */
export async function listTemplates(
  db: D1Database,
): Promise<{ docRef: string; title: string; dance: string; updatedAt: number }[]> {
  const rows = await drizzle(db)
    .select({
      docRef: documentRegistry.docRef,
      title: documentRegistry.title,
      dance: documentRegistry.dance,
      updatedAt: documentRegistry.updatedAt,
    })
    .from(documentRegistry)
    .where(
      and(
        eq(documentRegistry.ownerId, "app"),
        eq(documentRegistry.type, "routine"),
        isNull(documentRegistry.deletedAt),
      ),
    )
    .orderBy(desc(documentRegistry.updatedAt))
    .all();
  return rows.map((r) => ({
    docRef: r.docRef,
    title: r.title ?? "Untitled routine",
    dance: r.dance ?? "waltz",
    updatedAt: r.updatedAt,
  }));
}

export interface NewRoutine {
  docRef: string;
  ownerId: string;
  title: string;
  dance: string;
  /** Provenance for a choreo fork (US-037): the routine this was forked from. */
  forkedFromRef?: string | null;
}

/**
 * Eager-create a routine's D1 rows atomically: the owned registry row (so it's
 * immediately visible to the count/list) plus the creator's owner membership
 * (role=editor — #168 option (a); US-021's ownerId fallback is the belt to this
 * suspenders). The CRDT doc itself is created lazily by its DO on first open.
 * A fork passes `forkedFromRef` so the registry records its lineage (US-037).
 */
/**
 * Look up who owns a document (by the D1 registry PK — a fast PK lookup, no
 * SCAN). Returns null if the doc doesn't exist. Used by the fork route to allow
 * app-owned templates to be forked without a membership row (US-045/Task 6).
 */
export async function getDocOwner(db: D1Database, docRef: string): Promise<string | null> {
  const row = await drizzle(db)
    .select({ ownerId: documentRegistry.ownerId })
    .from(documentRegistry)
    .where(eq(documentRegistry.docRef, docRef))
    .get();
  return row?.ownerId ?? null;
}

export async function createOwnedRoutine(db: D1Database, r: NewRoutine): Promise<void> {
  const now = Date.now();
  const d = drizzle(db);
  await d.batch([
    d.insert(documentRegistry).values({
      docRef: r.docRef,
      type: "routine",
      ownerId: r.ownerId,
      doName: r.docRef, // one DO per document; doName is the idFromName key
      title: r.title,
      dance: r.dance,
      forkedFromRef: r.forkedFromRef ?? null,
      updatedAt: now,
    }),
    d.insert(membership).values({
      id: `mem_${r.ownerId}_${r.docRef}`,
      docRef: r.docRef,
      userId: r.ownerId,
      role: "editor",
      createdAt: now,
    }),
  ]);
}
