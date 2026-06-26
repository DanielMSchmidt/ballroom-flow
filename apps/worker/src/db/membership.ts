// US-020 — membership lookups against the D1 index.
//
// The single read the permission boundary needs: a user's ACTIVE role on ONE
// document. Returns null for a non-member (the DO maps that to 403). The pure
// role → capability mapping lives in @ballroom/domain (capabilitiesFor/can);
// this module only does the I/O.
import type { MembershipRole } from "@ballroom/domain";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { membership } from "./schema";

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
