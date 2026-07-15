// D31 (⟳v5) — the admin seam (docs/concepts/figures.md § Variants;
// docs/system/architecture.md § D1 — the index & projections;
// docs/concepts/collaboration.md § Who uses this; D31). Two tiny reads over the
// `users` row (migration 0014): whether a user is an admin, and the owned-routine
// cap that applies to them (the per-user override before the plan default).
//
// D1 is a pure index — this module only does the I/O; the quota RULE
// (FREE_ROUTINE_CAP) lives in db/routines.ts so it's never duplicated (#176).
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { FREE_ROUTINE_CAP } from "./routines";
import { users } from "./schema";

/**
 * Is this user an admin (D31)? Admins are the only editors of global figure docs
 * (a non-admin edit spawns a variant client-side, §5.2) and reach the §11 admin
 * surfaces (the global-figure seeder). A user with no `users` row (not yet
 * onboarded) is never an admin. Indexed PK lookup — no SCAN.
 */
export async function isAdmin(db: D1Database, userId: string): Promise<boolean> {
  const row = await drizzle(db)
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row?.isAdmin ?? false;
}

/** The owned-routine cap that applies to a user, with their plan (D21/D31). */
export interface RoutineCap {
  plan: string;
  /** The effective cap: the admin-granted override when set, else the plan default
   *  (FREE_ROUTINE_CAP for free; unbounded for pro). Compared as `owned >= cap`. */
  cap: number;
}

/**
 * The owned-routine cap the quota seam enforces for `userId`
 * (docs/concepts/collaboration.md § Plans, quotas & identity, D31). A
 * per-user `routineCapOverride` (an admin grant) wins over the plan default; a
 * free account with no override falls back to FREE_ROUTINE_CAP; a pro account is
 * unbounded (POSITIVE_INFINITY — `owned >= ∞` is never true, so no upsell). An
 * unknown user (no row) is treated as a capped free account. The override is read
 * BEFORE the plan default so raising a single user's cap needs no plan change.
 */
export async function routineCapFor(db: D1Database, userId: string): Promise<RoutineCap> {
  const row = await drizzle(db)
    .select({ plan: users.plan, override: users.routineCapOverride })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  const plan = row?.plan ?? "free";
  const cap = row?.override ?? (plan === "free" ? FREE_ROUTINE_CAP : Number.POSITIVE_INFINITY);
  return { plan, cap };
}
