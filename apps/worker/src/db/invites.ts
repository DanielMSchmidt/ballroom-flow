// US-023 — invite issue + redeem against the D1 index (PLAN §5.5, §4.7).
//
// SECURITY MODEL: the invite is an unguessable random token whose CONTENTS
// (docRef, role, expiry) live in D1, not in the token. The redeemer presents
// only the token; the server reads role+docRef from the matching row, so a
// redeemer can NEVER forge a doc or escalate a role by editing the token. The
// token is a 122-bit `crypto.randomUUID()` — a bearer secret, so deliberately
// NOT a time-ordered ULID (no guessable timestamp prefix).
//
// Redeem is single-use and race-safe: the redeemedAt stamp is claimed by an
// atomic conditional UPDATE, so two concurrent redeems can't double-grant.
import type { MembershipRole } from "@ballroom/domain";
import { newId } from "@ballroom/domain";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { roleFor } from "./membership";
import { invite, membership } from "./schema";

/** Default invite lifetime: 7 days. The alarm sweeps unredeemed expired ones. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Privilege ordering for upgrade-only redemption (never downgrade an existing role). */
const ROLE_RANK: Record<MembershipRole, number> = { viewer: 0, commenter: 1, editor: 2 };

export interface IssuedInvite {
  token: string;
  expiresAt: number;
}

/**
 * Mint an invite for `docRef` granting `role`. The caller MUST have already
 * checked the issuer may invite (can(role,"canInvite")) — this is pure I/O.
 * Returns the bearer token (the row's id) + its expiry.
 */
export async function issueInvite(
  db: D1Database,
  opts: { docRef: string; role: MembershipRole; ttlMs?: number },
): Promise<IssuedInvite> {
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + (opts.ttlMs ?? DEFAULT_TTL_MS);
  await drizzle(db).insert(invite).values({
    id: token,
    docRef: opts.docRef,
    role: opts.role,
    expiresAt,
  });
  return { token, expiresAt };
}

/** The outcome of a redeem — the route maps each reason to a status code. */
export type RedeemResult =
  | { ok: true; docRef: string; role: MembershipRole }
  | { ok: false; reason: "not_found" | "expired" | "already_redeemed" };

/**
 * Redeem `token` for `userId` (the VERIFIED JWT sub — never a client field).
 * Rejects an unknown (404), expired (410), or already-redeemed (409) invite.
 * On success it claims the single-use stamp atomically and grants membership at
 * the invite's role (upgrade-only — a viewer link never demotes an editor).
 */
export async function redeemInvite(
  db: D1Database,
  token: string,
  userId: string,
): Promise<RedeemResult> {
  const now = Date.now();
  const row = await drizzle(db).select().from(invite).where(eq(invite.id, token)).get();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.expiresAt < now) return { ok: false, reason: "expired" };
  if (row.redeemedAt != null) return { ok: false, reason: "already_redeemed" };

  // Single-use claim: only the writer that flips redeemedAt from NULL wins. A
  // concurrent second redeem sees changes===0 → already-redeemed (no double
  // grant). expiresAt>=now guards an expiry that slipped in since the read.
  const claim = await db
    .prepare(
      "UPDATE invite SET redeemedAt = ? WHERE id = ? AND redeemedAt IS NULL AND expiresAt >= ?",
    )
    .bind(now, token, now)
    .run();
  if ((claim.meta?.changes ?? 0) !== 1) return { ok: false, reason: "already_redeemed" };

  await grantMembership(db, row.docRef, userId, row.role as MembershipRole, now);
  return { ok: true, docRef: row.docRef, role: row.role as MembershipRole };
}

/**
 * Grant `userId` the invite's role on `docRef`, UPGRADE-ONLY: if they already
 * have an active membership we raise it to the higher of {existing, invite} and
 * never lower it (so a low-privilege link can't demote an existing member or the
 * owner). Owner elevation is orthogonal — resolveEffectiveRole elevates the
 * owner regardless of any row.
 */
async function grantMembership(
  db: D1Database,
  docRef: string,
  userId: string,
  role: MembershipRole,
  now: number,
): Promise<void> {
  const d = drizzle(db);
  const existing = await roleFor(db, docRef, userId);
  if (existing) {
    if (ROLE_RANK[role] > ROLE_RANK[existing]) {
      await d
        .update(membership)
        .set({ role })
        .where(
          and(
            eq(membership.docRef, docRef),
            eq(membership.userId, userId),
            isNull(membership.deletedAt),
          ),
        )
        .run();
    }
    return; // already a member at >= this role → no-op (never downgrade)
  }
  // Fresh grant. A new id (not the deterministic mem_user_doc) avoids a PK clash
  // with a prior soft-deleted row for the same (docRef,userId); the partial
  // unique index already guarantees one ACTIVE row.
  await d.insert(membership).values({
    id: newId(),
    docRef,
    userId,
    role,
    createdAt: now,
  });
}
