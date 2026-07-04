import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { renderUi, screen } from "./test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// Share-link regression: a signed-out friend opening an /invite/:token link.
//
// A share link is `/invite/:token`. The top-level gate deliberately keeps that
// route out of the marketing Landing so it can prompt sign-in — but the app
// shell's render chain checked `!isSignedIn` BEFORE the invite branch, so a
// signed-out visitor hit a generic "Sign in to build choreography" card with
// NO sign-in control and NO mention of the shared routine. Dead end.
//
// These tests prove the signed-out invite state now renders a real sign-in
// affordance + invite context, and does NOT auto-run redemption (which needs a
// token) while signed out.
// ─────────────────────────────────────────────────────────────────────────

// Signed-OUT auth context (the friend hasn't logged in yet).
vi.mock("./auth/app-auth", () => ({
  useAppAuth: () => ({
    getToken: async () => null,
    isLoaded: true,
    isSignedIn: false,
    signOut: async () => {},
  }),
  // Stand-in for Clerk's <SignInButton> so the test can assert a real sign-in
  // control is offered (the bug was: no control at all).
  AccountControls: () => <button type="button">Sign in</button>,
  NullAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./store/me", () => ({
  useMe: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("./store/figures", () => ({ loadMineFigures: async () => [] }));

// Landing must NOT be what a signed-out invite visitor sees; give it a testid so
// we can assert its absence on the invite route.
vi.mock("./components/Landing", () => ({
  Landing: () => <div data-testid="landing" />,
}));
// If redemption ever renders while signed out, this testid would appear — it
// must NOT (redeem needs a token). Guards against regressing back to auto-redeem.
vi.mock("./components/InviteRedeem", () => ({
  InviteRedeem: () => <div data-testid="invite-redeem" />,
}));

afterEach(() => {
  window.history.pushState(null, "", "/");
});

describe("share link — signed-out visitor on /invite/:token", () => {
  it("offers a sign-in control and explains the shared routine (not a dead-end card)", () => {
    window.history.pushState(null, "", "/invite/abc123");
    renderUi(<App />);

    // A real sign-in affordance is present (the dead-end card had none).
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    // Context makes clear this is a shared routine, not the generic app pitch.
    expect(screen.getByText(/you’ve been invited to a choreo/i)).toBeInTheDocument();
    // The old dead-end copy is gone.
    expect(screen.queryByText(/sign in to build choreography/i)).not.toBeInTheDocument();
  });

  it("does not render the marketing Landing on an invite route", () => {
    window.history.pushState(null, "", "/invite/abc123");
    renderUi(<App />);
    expect(screen.queryByTestId("landing")).not.toBeInTheDocument();
  });

  it("does not auto-run redemption while signed out (no token to redeem with)", () => {
    window.history.pushState(null, "", "/invite/abc123");
    renderUi(<App />);
    expect(screen.queryByTestId("invite-redeem")).not.toBeInTheDocument();
  });
});
