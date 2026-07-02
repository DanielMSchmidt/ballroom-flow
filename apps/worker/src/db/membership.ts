// US-020/US-021 — membership lookups against the D1 index.
//
// The reads the permission boundary needs: a user's ACTIVE role on ONE document,
// and the document's owner (for owner elevation). The pure role → capability
// mapping lives in @ballroom/domain (capabilitiesFor/can); this module only does
// the I/O.
import type { EffectiveRole, MembershipRole } from "@ballroom/domain";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { isAdmin } from "./admin";
import { cascadeFigureRole } from "./placement-edge";
import { documentRegistry, membership, userNameCache, users } from "./schema";

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

/** The document's registry `type` + `ownerId` in ONE indexed PK lookup, or null
 *  if the doc isn't indexed. Used by the effective-role resolver so the
 *  global-figure branch and the owner check share a single read. */
async function registryFor(
  db: D1Database,
  docRef: string,
): Promise<{ type: string; ownerId: string } | null> {
  const row = await drizzle(db)
    .select({ type: documentRegistry.type, ownerId: documentRegistry.ownerId })
    .from(documentRegistry)
    .where(eq(documentRegistry.docRef, docRef))
    .get();
  return row ?? null;
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
  const reg = await registryFor(db, docRef);
  if (reg) {
    if (reg.ownerId === userId) return "owner";
    // Global figure docs (⟳v5, §5.1/D28): every signed-in user is an implicit
    // VIEWER; only admins (User.isAdmin) are editors. A non-admin edit is realized
    // client-side as a variant spawn (§5.2), and the DO boundary rejects a direct
    // non-admin write. This precedes the routine→figure cascade below so a routine
    // editor who merely PLACES a catalog figure never gets write access to the
    // shared, admin-curated catalog doc (which would defeat variant protection).
    if (reg.type === "global-figure") {
      return (await isAdmin(db, userId)) ? "editor" : "viewer";
    }
  }
  // Cascade (2026-06-27): a routine member gets access to the figures that routine
  // references — an EDITOR may edit them, a commenter/viewer reads — so sharing a
  // routine shares its figures (+ annotations, which already live in the routine
  // doc). Inert for routine docs (a routineRef is never a figureRef in
  // placement_edge), so this only ever ADDS figure access.
  return cascadeFigureRole(db, docRef, userId);
}

/** One member of a document (for the US-024 Share screen member list).
 *  T8: `identityColor` + `displayName` are joined from the `users` table so
 *  annotation threads can show real identity colours without a separate fetch.
 *  Both are `undefined` when a member hasn't completed onboarding. */
export interface MemberRow {
  userId: string;
  role: MembershipRole;
  /** The member's stored identity colour hex (e.g. "#3b7dd8"). */
  identityColor?: string;
  /** The member's display name. */
  displayName?: string;
}

/** All ACTIVE members of `docRef` with their roles + identity (US-024 AC-1, T8). */
export async function listMembers(db: D1Database, docRef: string): Promise<MemberRow[]> {
  const rows = await drizzle(db)
    .select({
      userId: membership.userId,
      role: membership.role,
      identityColor: users.identityColor,
      displayName: users.displayName,
      // Fallback name for a member who's logged in but hasn't onboarded (no
      // `users` row): the name cached from their Clerk claims (migration 0013).
      cachedName: userNameCache.name,
    })
    .from(membership)
    .leftJoin(users, eq(membership.userId, users.id))
    .leftJoin(userNameCache, eq(membership.userId, userNameCache.id))
    .where(and(eq(membership.docRef, docRef), isNull(membership.deletedAt)))
    .all();
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role,
    identityColor: r.identityColor ?? undefined,
    // A chosen (onboarded) name wins; else the cached Clerk name; else the id.
    displayName: r.displayName ?? r.cachedName ?? undefined,
  }));
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
