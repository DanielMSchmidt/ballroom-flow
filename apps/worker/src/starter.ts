// apps/worker/src/starter.ts
// US-055 — seed the onboarding gift: a fork of the app-owned "Golden Waltz
// Basic" template. Converged in Task 6 to use forkRoutineFor (the same clone
// mechanism the /fork route uses), so the gift is a proper owned, independent
// copy. Figures are app-owned (the global shared library) — the user does NOT
// get per-user figure rows; they read them via the forked routine's figureRefs.
import { forkRoutineFor } from "./fork";
import type { Env } from "./index";
import { seedSampleRoutine } from "./sample";

/**
 * Seed the default starter routine for `userId` on first onboarding. Ensures
 * the app template exists (idempotent), then forks it for the user — quota is
 * skipped because this is a gift, not a user-initiated create. Returns the new
 * routine's id. Idempotent if called again: seedSampleRoutine is no-clobber,
 * and a second fork just produces another valid routine row for the user.
 */
export async function seedStarterRoutine(env: Env, userId: string): Promise<string> {
  // Ensure the app-owned template is seeded; returns the stable template id.
  const templateRef = await seedSampleRoutine(env);

  // Fork the template for the user, skipping the quota gate (gift).
  const result = await forkRoutineFor(env, { originRef: templateRef, userId, skipQuota: true });

  // skipQuota:true means the upsell branch can never trigger — guard for TS.
  if ("upsell" in result) throw new Error("unexpected quota block on onboarding gift");

  return result.docRef;
}
