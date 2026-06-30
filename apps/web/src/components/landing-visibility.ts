// Pure gate for the logged-out landing page, isolated so it's unit-testable
// without rendering the whole app shell.
export function shouldShowLanding(isSignedIn: boolean, routeName: string): boolean {
  if (isSignedIn) return false;
  // Invite deep-links must still reach the redemption flow (which prompts sign-in).
  return routeName !== "invite";
}

/** What the app's root should render once routing + auth are known. */
export type AppGate = "loading" | "landing" | "app";

/**
 * Top-level gate: marketing Landing vs. the app shell, with a "loading" state
 * while auth is still resolving.
 *
 * The "loading" state is what makes a signed-in user land on the choreo list
 * instead of the marketing page: until Clerk reports auth, `isSignedIn` reads
 * false, which would otherwise show the logged-out Landing for a beat before
 * flipping to the app. Holding at "loading" until `authLoaded` avoids that
 * flash so the signed-in path goes straight to the app (the choreo list).
 */
export function appGate(authLoaded: boolean, isSignedIn: boolean, routeName: string): AppGate {
  if (!authLoaded) return "loading";
  if (shouldShowLanding(isSignedIn, routeName)) return "landing";
  return "app";
}
