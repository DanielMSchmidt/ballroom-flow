// Pure gate for the logged-out landing page, isolated so it's unit-testable
// without rendering the whole app shell.
export function shouldShowLanding(isSignedIn: boolean, routeName: string): boolean {
  if (isSignedIn) return false;
  // Invite deep-links must still reach the redemption flow (which prompts sign-in).
  return routeName !== "invite";
}
