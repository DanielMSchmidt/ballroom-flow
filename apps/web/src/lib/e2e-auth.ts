// E2E-only auth bypass (#191). This is NEVER active in a real build: it is gated
// on the `VITE_E2E` build flag, which is unset in dev/staging/prod, so `isE2E()`
// folds to a constant `false` and the bypass is dead-code-eliminated.
//
// When active (the Playwright preview build sets VITE_E2E=1), the app renders
// signed-in from a test session that Playwright's `seedAuth` injects into
// localStorage BEFORE any app code runs, and getToken returns the injected,
// real-but-test-signed JWT. The worker (run with the test CLERK_JWT_KEY PEM)
// verifies it networklessly — so journeys exercise the real auth boundary
// end-to-end without live Clerk.

/** localStorage key Playwright's seedAuth writes the impersonated session to. */
export const E2E_SESSION_KEY = "ballroom-e2e-session";

/**
 * localStorage key for a PENDING (staged-but-inactive) session. Playwright's
 * `stagePendingAuth` writes it so the app boots SIGNED OUT (readE2ESession reads
 * only the active key), then the in-app E2E sign-in control promotes it to the
 * active session — modelling a signed-out visitor completing sign-in. This is
 * how the Clerk-less harness exercises signed-out entry points (e.g. a friend
 * opening an /invite/:token share link).
 */
export const E2E_PENDING_SESSION_KEY = "ballroom-e2e-pending-session";

export interface E2ESession {
  /** The Clerk-style `sub` (the seeded user id). */
  sub: string;
  /** A real RS256 JWT for `sub`, signed by the fixed test key. */
  token: string;
}

/**
 * True ONLY in an E2E build (`VITE_E2E=1`). In every real build this is a
 * compile-time constant `false`, so the Clerk path is the only one that ships.
 */
export function isE2E(): boolean {
  return import.meta.env.VITE_E2E === "1";
}

/** Read the injected E2E session, or null if none/malformed. */
export function readE2ESession(): E2ESession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(E2E_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<E2ESession>;
    if (typeof parsed.sub === "string" && typeof parsed.token === "string") {
      return { sub: parsed.sub, token: parsed.token };
    }
  } catch {
    // malformed session — treat as signed-out
  }
  return null;
}

/**
 * E2E-only: complete a "sign-in". Promotes the staged pending session to the
 * active session and reloads to the SAME URL — mirroring Clerk returning the
 * user signed-in to where they started (e.g. an /invite/:token deep link, so
 * redemption then runs). No-op outside an E2E build or with no pending session.
 * Returns whether a sign-in was completed (so the caller can fall back).
 */
export function completeE2ESignIn(): boolean {
  if (!isE2E() || typeof window === "undefined") return false;
  const pending = window.localStorage.getItem(E2E_PENDING_SESSION_KEY);
  if (!pending) return false;
  window.localStorage.setItem(E2E_SESSION_KEY, pending);
  window.localStorage.removeItem(E2E_PENDING_SESSION_KEY);
  window.location.reload();
  return true;
}
