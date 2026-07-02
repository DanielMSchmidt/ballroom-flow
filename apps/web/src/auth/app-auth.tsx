// The app's auth seam (#191). Components and the store read auth through
// `useAppAuth()` — never Clerk's `useAuth` directly — so the live-Clerk path and
// the E2E test path are interchangeable behind one interface:
//   • prod/dev: a real <ClerkProvider> + a bridge that surfaces Clerk's
//     getToken / isSignedIn into the context;
//   • E2E (VITE_E2E=1): no Clerk at all — the injected test session supplies the
//     token and "signed in" state.
// This is what lets the Playwright journeys run against the real worker boundary
// without live Clerk, while production still uses Clerk unchanged.
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  useAuth,
} from "@clerk/clerk-react";
import { createContext, type ReactNode, useContext } from "react";
import { completeE2ESignIn, E2E_SESSION_KEY, isE2E, readE2ESession } from "../lib/e2e-auth";
import { Button } from "../ui";

export interface AppAuth {
  /** A fresh bearer token for the API/WS, or null when signed out. */
  getToken: () => Promise<string | null>;
  /**
   * Whether auth has resolved. Until this is true, `isSignedIn` is not yet
   * known (Clerk is still loading), so the shell must hold off deciding between
   * the marketing Landing and the app — otherwise a signed-in user is flashed
   * the logged-out Landing before Clerk reports them in.
   */
  isLoaded: boolean;
  /** Whether a user is signed in (gates the signed-in/out UI). */
  isSignedIn: boolean;
  /** Sign the user out (Clerk in prod; clears the injected session in E2E). */
  signOut: () => Promise<void>;
}

const AppAuthContext = createContext<AppAuth | null>(null);

/** Read the app's auth (token + signed-in state). Works in both Clerk and E2E modes. */
export function useAppAuth(): AppAuth {
  const ctx = useContext(AppAuthContext);
  if (!ctx) throw new Error("useAppAuth must be used within <AppAuthProvider>");
  return ctx;
}

/** No-op auth provider for component unit tests. Provides a signed-out context so
 *  hooks that call `useAppAuth()` work without a real Clerk or E2E setup. Queries
 *  that call `getToken()` receive `null` and fail gracefully (no network in jsdom). */
export function NullAuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <AppAuthContext.Provider
      value={{
        getToken: async () => null,
        isLoaded: true,
        isSignedIn: false,
        signOut: async () => {},
      }}
    >
      {children}
    </AppAuthContext.Provider>
  );
}

/** Bridge live Clerk auth into the context (prod/dev). Rendered inside ClerkProvider. */
function ClerkAuthBridge({ children }: { children: ReactNode }): React.JSX.Element {
  const { getToken, isLoaded, isSignedIn, signOut } = useAuth();
  return (
    <AppAuthContext.Provider
      value={{
        getToken: () => getToken(),
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        signOut: () => signOut(),
      }}
    >
      {children}
    </AppAuthContext.Provider>
  );
}

/** E2E bridge: signed-in from the injected session; getToken returns the test JWT. */
function E2EAuthBridge({ children }: { children: ReactNode }): React.JSX.Element {
  const session = readE2ESession();
  return (
    <AppAuthContext.Provider
      value={{
        getToken: async () => session?.token ?? null,
        // The injected session is read synchronously, so E2E is never "loading".
        isLoaded: true,
        isSignedIn: session !== null,
        // No Clerk in E2E: drop the injected session + reload to the signed-out shell.
        signOut: async () => {
          window.localStorage.removeItem(E2E_SESSION_KEY);
          window.location.assign("/");
        },
      }}
    >
      {children}
    </AppAuthContext.Provider>
  );
}

/**
 * Provide app auth. In E2E mode there is no Clerk; otherwise a real ClerkProvider
 * wraps the bridge. `publishableKey` is required for the Clerk path (the caller
 * shows a config hint when it's missing — see main.tsx).
 */
export function AppAuthProvider({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: ReactNode;
}): React.JSX.Element {
  if (isE2E()) return <E2EAuthBridge>{children}</E2EAuthBridge>;
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}

/**
 * The header account control: Clerk's SignIn/User buttons in prod, a plain
 * marker in E2E (where there's no Clerk widget to render).
 */
export function AccountControls(): React.JSX.Element {
  if (isE2E()) return <E2EAccountControls />;
  return (
    <>
      <SignedOut>
        {/* Render Clerk's SignInButton as the app's real Button (not the bare
            unstyled default link) so sign-in reads as a proper CTA and matches
            the E2E control below. SignInButton clones this child + wires its
            onClick; Button forwards it via {...rest}. */}
        <SignInButton>
          <Button variant="primary" size="sm">
            Sign in
          </Button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </>
  );
}

/**
 * E2E account control (no Clerk widget to render). Signed in → a plain marker;
 * signed out → a real "Sign in" button that promotes the staged pending session
 * (completeE2ESignIn) and reloads to the same URL. That lets signed-out entry
 * points — a friend opening an /invite/:token share link — be driven end-to-end
 * in the Clerk-less harness, mirroring Clerk returning the user signed-in.
 */
function E2EAccountControls(): React.JSX.Element {
  const { isSignedIn } = useAppAuth();
  if (isSignedIn) {
    return (
      <span data-testid="e2e-account" className="text-2xs text-ink-muted">
        Signed in
      </span>
    );
  }
  return (
    <Button variant="primary" size="sm" onClick={() => completeE2ESignIn()}>
      Sign in
    </Button>
  );
}
