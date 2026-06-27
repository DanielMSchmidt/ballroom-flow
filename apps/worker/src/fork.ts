// apps/worker/src/fork.ts
// Shared fork-routine helper (US-037/US-045/US-055). Extracted from the
// POST /api/routines/:id/fork route so the onboarding gift (starter.ts) can
// reuse the exact same snapshot-clone logic without duplicating it.
import { newId } from "@ballroom/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { countOwnedRoutines, createOwnedRoutine } from "./db/routines";
import { users } from "./db/schema";
import type { Env } from "./index";

/** Free-plan owned-routine cap (must match the constant in index.ts). */
const FREE_ROUTINE_CAP = 3;

export interface ForkSuccess {
  docRef: string;
  title: string;
  dance: string;
  forkedFromRef: string;
}

export interface ForkUpsell {
  upsell: true;
  cap: number;
  owned: number;
  plan: string;
}

/**
 * Clone a routine into a new, owned document for `userId`. Identical to the
 * logic formerly inline in POST /api/routines/:id/fork, but extracted so
 * seedStarterRoutine can share it (passing skipQuota:true for the gift).
 *
 * Returns a ForkSuccess with the new doc's metadata, or a ForkUpsell marker
 * when the user is at/over their plan quota and skipQuota is false/omitted.
 * The caller is responsible for auth checks (role / owner) before calling.
 */
export async function forkRoutineFor(
  env: Env,
  { originRef, userId, skipQuota }: { originRef: string; userId: string; skipQuota?: boolean },
): Promise<ForkSuccess | ForkUpsell> {
  // Quota gate (unless caller explicitly bypasses for gifting).
  if (!skipQuota) {
    const db = drizzle(env.DB);
    const me = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).get();
    const plan = me?.plan ?? "free";
    const owned = await countOwnedRoutines(env.DB, userId);
    if (plan === "free" && owned >= FREE_ROUTINE_CAP) {
      return { upsell: true, cap: FREE_ROUTINE_CAP, owned, plan };
    }
  }

  // Snapshot the origin's CRDT content and clone it into a fresh, owned doc.
  // Referenced figures stay shared (placements keep their figureRefs); the new
  // doc gets no shared Automerge history → frozen from later origin edits.
  const origin = await env.DOC_DO.get(env.DOC_DO.idFromName(originRef)).getSnapshot();
  const docRef = newId();
  const title = origin.title ?? "Untitled routine";
  const dance = origin.dance ?? "waltz";

  await createOwnedRoutine(env.DB, {
    docRef,
    ownerId: userId,
    title,
    dance,
    forkedFromRef: originRef,
  });

  await env.DOC_DO.get(env.DOC_DO.idFromName(docRef)).seedDoc({
    ...origin,
    id: docRef,
    ownerId: userId,
    forkedFromRef: originRef,
    schemaVersion: origin.schemaVersion ?? 1,
    deletedAt: null,
  });

  return { docRef, title, dance, forkedFromRef: originRef };
}
