// US-020/US-021 — membership lookups against the D1 index.
//
// The reads the permission boundary needs: a user's ACTIVE role on ONE document,
// and the document's owner (for owner elevation). The pure role → capability
// mapping lives in @ballroom/domain (capabilitiesFor/can); this module only does
// the I/O.
import type { EffectiveRole, MembershipRole } from "@ballroom/domain";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { documentRegistry, membership } from "./schema";

/** The connecting user's active role on `docRef`, or null if not a member. */
export async function roleFor(
  db: D1Database,
  docRef: string,
  userId: string,
): Promise<MembershipRole | null> {
  const row = await drizzle(db)
    .select({ role: membership.role })
    .from(membership)
    .where(
      and(
        eq(membership.docRef, docRef),
        eq(membership.userId, userId),
        isNull(membership.deletedAt),
      ),
    )
    .get();
  return row?.role ?? null;
}

/** The document's owner (document_registry.ownerId), or null if not indexed. */
export async function ownerOf(db: D1Database, docRef: string): Promise<string | null> {
  const row = await drizzle(db)
    .select({ ownerId: documentRegistry.ownerId })
    .from(documentRegistry)
    .where(eq(documentRegistry.docRef, docRef))
    .get();
  return row?.ownerId ?? null;
}

/**
 * The user's EFFECTIVE role on a document for the permission boundary (US-021).
 * A stored membership wins; otherwise the document owner is elevated to "owner"
 * (editor + delete) even with no membership row (#168 — owner must never be
 * locked out of their own doc). Returns null for a genuine non-member.
 */
export async function resolveEffectiveRole(
  db: D1Database,
  docRef: string,
  userId: string,
): Promise<EffectiveRole | null> {
  const role = await roleFor(db, docRef, userId);
  if (role) return role;
  const owner = await ownerOf(db, docRef);
  return owner !== null && owner === userId ? "owner" : null;
}

/** One member of a document (for the US-024 Share screen member list). */
export interface MemberRow {
  userId: string;
  role: MembershipRole;
}

/** All ACTIVE members of `docRef` with their roles (US-024 AC-1). */
export async function listMembers(db: D1Database, docRef: string): Promise<MemberRow[]> {
  const rows = await drizzle(db)
    .select({ userId: membership.userId, role: membership.role })
    .from(membership)
    .where(and(eq(membership.docRef, docRef), isNull(membership.deletedAt)))
    .all();
  return rows;
}

/**
 * Remove a member from `docRef` (US-024 AC-2): SOFT-delete their active
 * membership row (set `deletedAt`) — never a hard removal. The caller authorizes
 * (editor/owner via can(role,"canInvite")). Returns the number of rows tombstoned.
 */
export async function removeMember(
  db: D1Database,
  docRef: string,
  userId: string,
): Promise<number> {
  const res = await db
    .prepare(
      "UPDATE membership SET deletedAt = ? WHERE docRef = ? AND userId = ? AND deletedAt IS NULL",
    )
    .bind(Date.now(), docRef, userId)
    .run();
  return res.meta?.changes ?? 0;
}
