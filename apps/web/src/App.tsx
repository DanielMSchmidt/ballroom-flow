import { useCallback, useState } from "react";
import { AccountControls, useAppAuth } from "./auth/app-auth";
import { ChoreoFlow } from "./components/ChoreoFlow";
import { FigureLibrary } from "./components/FigureLibrary";
import { InviteRedeem } from "./components/InviteRedeem";
import { Landing } from "./components/Landing";
import { shouldShowLanding } from "./components/landing-visibility";
import { ProfileScreen } from "./components/Profile";
import { navigate, useRoute } from "./lib/router";
import { loadMineFigures } from "./store/figures";
import { useMe } from "./store/me";
import { Styleguide } from "./styleguide/Styleguide";
import { AppShell, Button, Card, type NavItem, Tabs, ToastProvider } from "./ui";
import { JournalIcon, LibraryIcon, PersonIcon, StepsIcon } from "./ui/icons";

/**
 * Is the styleguide route active? The gallery is a DEVELOPMENT-only tool — gated
 * behind `import.meta.env.DEV` so it is NOT reachable in a shipped staging/prod
 * build (#192). Product routes are owned by the real router (lib/router.ts).
 */
function isStyleguideRoute(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  return (
    window.location.pathname.replace(/\/$/, "").endsWith("/styleguide") ||
    window.location.hash.replace(/^#\/?/, "") === "styleguide"
  );
}

const NAV: NavItem[] = [
  { value: "choreo", label: "Choreo", icon: () => <StepsIcon size={22} /> },
  { value: "library", label: "Library", icon: () => <LibraryIcon size={22} /> },
  { value: "journal", label: "Journal", icon: () => <JournalIcon size={22} /> },
  { value: "profile", label: "Profile", icon: () => <PersonIcon size={22} /> },
];

export function App(): React.JSX.Element {
  return <ToastProvider>{isStyleguideRoute() ? <Styleguide /> : <AppHome />}</ToastProvider>;
}

/**
 * AppHome — the signed-in/out shell. Auth flows through the app's auth seam
 * (useAppAuth / AccountControls), so the live-Clerk and E2E paths share one
 * surface. The open routine and invite redemption are URL-driven (lib/router.ts).
 */
function AppHome(): React.JSX.Element {
  const route = useRoute();
  const { isSignedIn, getToken } = useAppAuth();
  const me = useMe();
  const [tab, setTab] = useState("choreo");
  // US-033: "My figures" toggle — stable so FigureLibrary's effect deps don't refetch on every render.
  const [libTab, setLibTab] = useState<"all" | "mine">("all");
  const loadMine = useCallback(async () => loadMineFigures(await getToken()), [getToken]);
  const openRoutineId = route.name === "routine" ? route.id : undefined;
  // First-run nudge: a signed-in user who hasn't set a name/colour yet (US-019)
  // is pointed at Profile, so they aren't shown as a raw id to co-editors.
  const needsOnboarding =
    isSignedIn && me.data?.onboarded === false && tab !== "profile" && route.name !== "invite";

  if (shouldShowLanding(isSignedIn, route.name)) return <Landing />;

  return (
    <AppShell
      nav={NAV}
      current={tab}
      onNavigate={(t) => {
        setTab(t);
        navigate("/"); // leaving an open routine returns to the list
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 lg:border-b-0 lg:px-0">
        <h1 className="text-lg font-bold tracking-tight text-ink lg:hidden">Ballroom Flow</h1>
        <div className="ml-auto flex items-center gap-2">
          <AccountControls />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4 lg:p-0 lg:pt-4">
        {needsOnboarding && (
          <Card>
            <div className="flex items-center justify-between gap-3">
              <p className="text-2xs text-ink-secondary">
                Add your name and note colour so co-editors know who's who.
              </p>
              <Button variant="primary" size="sm" onClick={() => setTab("profile")}>
                Set up profile
              </Button>
            </div>
          </Card>
        )}
        {!isSignedIn ? (
          <Card>
            <p className="text-sm font-bold text-ink">Sign in to build choreography</p>
            <p className="mt-1 text-2xs text-ink-muted">
              Ballroom Flow keeps your routines in sync across your devices.
            </p>
          </Card>
        ) : route.name === "invite" ? (
          <InviteRedeem token={route.token} />
        ) : openRoutineId || tab === "choreo" ? (
          <ChoreoFlow openRoutineId={openRoutineId} />
        ) : tab === "library" ? (
          <>
            <Tabs
              label="Library view"
              items={[
                { value: "all", label: "All" },
                { value: "mine", label: "My figures" },
              ]}
              value={libTab}
              onChange={(v) => setLibTab(v as "all" | "mine")}
            />
            <FigureLibrary tab={libTab} loadMine={loadMine} />
          </>
        ) : tab === "profile" ? (
          <ProfileScreen />
        ) : (
          <Card>
            <p className="text-sm font-bold text-ink">Coming soon</p>
            <p className="mt-1 text-2xs text-ink-muted">This screen lands in a later milestone.</p>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
