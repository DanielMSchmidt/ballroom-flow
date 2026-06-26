// US-022/US-025 — routine create + quota lookups against the D1 index.
//
// D1 is the source of truth for the owned-routine count (quota) and the list.
// Create EAGER-projects the registry row (+ the owner membership row) so the
// count/list see a new routine immediately (#129) — edits stay alarm-projected.
import { and, count, eq, isNull } from "drizzle-orm";
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

export interface NewRoutine {
  docRef: string;
  ownerId: string;
  title: string;
  dance: string;
}

/**
 * Eager-create a routine's D1 rows atomically: the owned registry row (so it's
 * immediately visible to the count/list) plus the creator's owner membership
 * (role=editor — #168 option (a); US-021's ownerId fallback is the belt to this
 * suspenders). The CRDT doc itself is created lazily by its DO on first open.
 */
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
