import { AccountControls } from "../auth/app-auth";
import { Card } from "../ui";

/**
 * Signed-out prompt shown *inside* the app shell. The only signed-out route that
 * reaches the shell (instead of the marketing Landing) is an invite deep-link
 * (/invite/:token) — a friend opening a share link. That screen used to be a dead
 * end: a bare "Sign in" card with no sign-in control and no mention of the shared
 * routine (the friend was stuck). This renders context + the real sign-in control
 * (AccountControls → Clerk's SignInButton), so after signing in the visitor
 * returns to the same invite URL and InviteRedeem opens the shared routine.
 */
export function SignInPrompt({ invited = false }: { invited?: boolean }): React.JSX.Element {
  return (
    <Card>
      <p className="text-sm font-bold text-ink">
        {invited ? "You’ve been invited to a choreo" : "Sign in to build choreography"}
      </p>
      <p className="mt-1 text-2xs text-ink-muted">
        {invited
          ? "Sign in to open the shared choreography — Ballroom Flow keeps it in sync across your devices."
          : "Ballroom Flow keeps your choreos in sync across your devices."}
      </p>
      <div className="mt-3">
        <AccountControls />
      </div>
    </Card>
  );
}
