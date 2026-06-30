import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { renderUi, screen } from "./test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// T1 — App shell & navigation parity
//
// The signed-in shell must NOT render a persistent "Ballroom Flow" heading
// above the tab content. The design places the app name only in the desktop
// side-rail (as a <span>), not as an <h1> visible on mobile inner tabs.
//
// Invariant: AccountControls / sign-out stays reachable via the Profile tab
// (owned by T7); this test only gates the global-header removal.
// ─────────────────────────────────────────────────────────────────────────

// Provide a signed-in auth context without a real Clerk setup.
vi.mock("./auth/app-auth", () => ({
  useAppAuth: () => ({
    getToken: async () => "test-token",
    isLoaded: true,
    isSignedIn: true,
    signOut: async () => {},
  }),
  // AccountControls is rendered inside the now-removed persistent header;
  // returning null is fine for this unit test.
  AccountControls: () => null,
  // NullAuthProvider is used by renderUi's Providers wrapper — pass children through.
  NullAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./store/me", () => ({
  useMe: () => ({ data: { onboarded: true }, isLoading: false }),
}));

vi.mock("./store/figures", () => ({
  loadMineFigures: async () => [],
}));

// Stub the heavyweight screen components so the shell renders fast without
// store / WebSocket dependencies.
vi.mock("./components/ChoreoFlow", () => ({
  ChoreoFlow: () => <div data-testid="choreo-flow" />,
}));
vi.mock("./components/FigureLibrary", () => ({
  FigureLibrary: () => <div data-testid="figure-library" />,
}));
vi.mock("./components/Profile", () => ({
  ProfileScreen: () => <div data-testid="profile-screen" />,
}));
vi.mock("./components/Landing", () => ({
  Landing: () => <div data-testid="landing" />,
}));

describe("T1 — App shell: no persistent app-name header on inner tabs", () => {
  it("does not render a Ballroom Flow heading in the signed-in shell", () => {
    // Intent: the persistent "Ballroom Flow / Signed in" bar must be absent.
    // The side-rail uses a <span> (not a heading role), so no heading should be
    // found anywhere once the App.tsx header <h1> is removed.
    // RED: fails while App.tsx still renders <h1>Ballroom Flow</h1>.
    // GREEN: passes once the persistent header is removed.
    renderUi(<App />);
    const headings = screen.queryAllByRole("heading", { name: /ballroom flow/i });
    expect(headings).toHaveLength(0);
  });

  it("renders the Choreo tab content by default", () => {
    // Intent: the default tab (choreo) shows the ChoreoFlow component, not a bare
    // "coming soon" placeholder.
    renderUi(<App />);
    expect(screen.getByTestId("choreo-flow")).toBeInTheDocument();
  });
});
