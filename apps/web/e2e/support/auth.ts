// ─────────────────────────────────────────────────────────────────────────
// Deterministic E2E auth (PLAN §10.3: "deterministic auth+seed"). Establishes a
// signed-in session for a seeded user WITHOUT live Clerk, so journeys are
// reproducible offline.
//
// MECHANISM (#191): the E2E build (VITE_E2E=1) reads an injected test session
// from localStorage and renders signed-in, with getToken returning the injected
// token. Here we mint a REAL test-signed JWT for `userId` and inject it before
// any app code runs; the worker (run with the matching test CLERK_JWT_KEY)
// verifies it networklessly — exercising the real auth boundary end-to-end.
// ─────────────────────────────────────────────────────────────────────────
import type { Page } from "@playwright/test";
import { mintTestJWT } from "./jwt";

/** localStorage key the E2E build reads its impersonated session from. */
export const E2E_SESSION_KEY = "ballroom-e2e-session";

/** localStorage key for a staged-but-inactive session (see stagePendingAuth). */
export const E2E_PENDING_SESSION_KEY = "ballroom-e2e-pending-session";

/**
 * Sign a page in as `userId`: mint a test JWT and inject the session before any
 * app code runs (addInitScript), so the app boots signed-in as that user.
 */
export async function seedAuth(page: Page, userId: string): Promise<void> {
  const token = await mintTestJWT(userId);
  const session = JSON.stringify({ sub: userId, token });
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [E2E_SESSION_KEY, session] as const,
  );
}

/**
 * Stage a PENDING session for `userId`: mint the JWT but write it to the pending
 * key, so the app boots SIGNED OUT. The in-app E2E "Sign in" control then
 * promotes it to the active session (completeE2ESignIn) and reloads to the same
 * URL — modelling a signed-out visitor completing sign-in. Use to drive
 * signed-out entry points end-to-end (e.g. opening an /invite/:token link).
 */
export async function stagePendingAuth(page: Page, userId: string): Promise<void> {
  const token = await mintTestJWT(userId);
  const session = JSON.stringify({ sub: userId, token });
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [E2E_PENDING_SESSION_KEY, session] as const,
  );
}

/** Navigate to a routine as an already-seeded user. */
export async function gotoRoutine(page: Page, routineId: string): Promise<void> {
  await page.goto(`/routines/${routineId}`);
}
