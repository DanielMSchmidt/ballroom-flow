// docs/system/sync-and-offline.md § Offline editing — offline app OPEN. On an installed PWA opened with no network,
// live Clerk cannot initialize (`isLoaded` never turns true), which used to
// hold the entire app on the full-screen auth spinner forever. The auth seam
// now FAILS OPEN to the last-known signed-in identity cached on this device:
// the shell renders, locally persisted data serves, and getToken() resolves
// null (every server boundary still enforces auth — offline they're
// unreachable anyway). When Clerk does load, its verdict always wins.
//
// This is component-tested (not E2E): the Playwright harness runs the
// Clerk-less E2E bridge, so the live-Clerk offline path can only be exercised
// by mocking @clerk/clerk-react.
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable mock state for @clerk/clerk-react — each test shapes Clerk's answer.
// Annotated (not asserted) so tests can reassign userId/getToken per case.
const clerkAuth: {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
} = {
  isLoaded: false,
  isSignedIn: false,
  userId: null,
  getToken: async () => null,
  signOut: async () => {},
};
vi.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => clerkAuth,
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: () => null,
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  UserButton: () => null,
}));

import { AppAuthProvider, LAST_SIGNED_IN_KEY, useAppAuth } from "./app-auth";

/** Probe that renders the seam's verdict as text. */
function Probe(): React.JSX.Element {
  const { isLoaded, isSignedIn } = useAppAuth();
  return (
    <span data-testid="auth-state">
      {isLoaded ? "loaded" : "loading"}:{isSignedIn ? "in" : "out"}
    </span>
  );
}

const renderSeam = () =>
  render(
    <AppAuthProvider publishableKey="pk_test_x">
      <Probe />
    </AppAuthProvider>,
  );

const goOffline = (): void => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
};

beforeEach(() => {
  clerkAuth.isLoaded = false;
  clerkAuth.isSignedIn = false;
  clerkAuth.userId = null;
  localStorage.clear();
});
afterEach(() => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
});

describe("offline auth fail-open (PLAN §11.2 — offline app open)", () => {
  it("OFFLINE + Clerk not loaded + cached identity → renders signed-in (no endless spinner)", () => {
    goOffline();
    localStorage.setItem(LAST_SIGNED_IN_KEY, "user_coach");
    renderSeam();
    expect(screen.getByTestId("auth-state").textContent).toBe("loaded:in");
  });

  it("OFFLINE + Clerk not loaded + NO cached identity → resolves signed-out (landing, not spinner)", () => {
    goOffline();
    renderSeam();
    expect(screen.getByTestId("auth-state").textContent).toBe("loaded:out");
  });

  it("ONLINE + Clerk not loaded → still 'loading' (the normal boot spinner, unchanged)", () => {
    localStorage.setItem(LAST_SIGNED_IN_KEY, "user_coach");
    renderSeam();
    expect(screen.getByTestId("auth-state").textContent).toBe("loading:out");
  });

  it("Clerk's verdict WINS once loaded, and a signed-in load caches the identity", () => {
    clerkAuth.isLoaded = true;
    clerkAuth.isSignedIn = true;
    clerkAuth.userId = "user_coach";
    renderSeam();
    expect(screen.getByTestId("auth-state").textContent).toBe("loaded:in");
    expect(localStorage.getItem(LAST_SIGNED_IN_KEY)).toBe("user_coach");
  });

  it("a resolved SIGNED-OUT load clears the cached identity (no stale offline sign-in)", () => {
    localStorage.setItem(LAST_SIGNED_IN_KEY, "user_coach");
    clerkAuth.isLoaded = true;
    clerkAuth.isSignedIn = false;
    renderSeam();
    expect(screen.getByTestId("auth-state").textContent).toBe("loaded:out");
    expect(localStorage.getItem(LAST_SIGNED_IN_KEY)).toBeNull();
  });
});
