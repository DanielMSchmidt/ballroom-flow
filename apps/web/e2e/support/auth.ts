// ─────────────────────────────────────────────────────────────────────────
// Deterministic E2E auth (PLAN §10.3: "deterministic auth+seed"). Establishes a
// signed-in session for a seeded user WITHOUT live Clerk, so multi-user journeys
// are reproducible offline.
//
// MECHANISM (wired in M3): the preview build runs in an E2E mode where the app
// reads a test session token (set here via addInitScript / a cookie) instead of
// the live Clerk widget, and the worker verifies it against the test PEM
// (CLERK_JWT_KEY) — the same networkless path as the worker tests' makeTestJWT.
// Until that mode exists, the E2E specs that use this are skipped.
// ─────────────────────────────────────────────────────────────────────────
import type { Page } from "@playwright/test";

/** Storage key the E2E build reads its impersonated session from (M3 contract). */
export const E2E_SESSION_KEY = "ballroom-e2e-session";

/**
 * Sign a page in as `userId` by injecting a test session before any app code
 * runs. The token is a placeholder here; M3 swaps in a real signed test JWT
 * minted from the shared test keypair (mirrors the worker layer's makeTestJWT).
 */
export async function seedAuth(page: Page, userId: string): Promise<void> {
  await page.addInitScript(
    ([key, uid]) => {
      window.localStorage.setItem(key, JSON.stringify({ sub: uid, e2e: true }));
    },
    [E2E_SESSION_KEY, userId] as const,
  );
}

/** Navigate to a routine as an already-seeded user. */
export async function gotoRoutine(page: Page, routineId: string): Promise<void> {
  await page.goto(`/routines/${routineId}`);
}
