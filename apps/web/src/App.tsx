import { useCallback, useState } from "react";
import { useAppAuth } from "./auth/app-auth";
import { ChoreoFlow } from "./components/ChoreoFlow";
import { FigureLibrary, type SaveLibraryInput } from "./components/FigureLibrary";
import { InviteRedeem } from "./components/InviteRedeem";
import { Journal } from "./components/Journal";
import { Landing } from "./components/Landing";
import { appGate } from "./components/landing-visibility";
import { ProfileScreen } from "./components/Profile";
import { SignInPrompt } from "./components/SignInPrompt";
import { navigate, useRoute } from "./lib/router";
import { createFamilyNote } from "./store/family-notes";
import { loadMineFigures, saveFigureToLibrary } from "./store/figures";
import {
  createRoutineJournalEntry,
  loadJournal,
  loadRoutineFigureOptions,
  loadRoutineOptions,
} from "./store/journal";
import { useMe } from "./store/me";
import { Styleguide } from "./styleguide/Styleguide";
import { AppShell, Button, Card, type NavItem, Spinner, Tabs, ToastProvider } from "./ui";
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
 * (useAppAuth), so the live-Clerk and E2E paths share one surface. Account /
 * sign-out lives on the Profile tab (T1: no persistent app-name bar on inner
 * screens). The open routine and invite redemption are URL-driven (lib/router.ts).
 */
function AppHome(): React.JSX.Element {
  const route = useRoute();
  const { isLoaded, isSignedIn, getToken } = useAppAuth();
  const me = useMe();
  const [tab, setTab] = useState("choreo");
  // US-033: "My figures" toggle — stable so FigureLibrary's effect deps don't refetch on every render.
  const [libTab, setLibTab] = useState<"all" | "mine">("all");
  const loadMine = useCallback(async () => loadMineFigures(await getToken()), [getToken]);
  // T5: "↟ Save to my library" — promote a global figure into the user's personal
  // library (frozen account-figure copy). Stable identity so cards don't rebind.
  const onSaveToLibrary = useCallback(
    async (input: SaveLibraryInput) => saveFigureToLibrary(await getToken(), input),
    [getToken],
  );
  // T6 — Journal data + create wiring through the store seam. `createRoutineEntry`
  // opens the chosen routine's editable store and createAnnotation (full parity);
  // `createFamilyEntry` authors an account figureType note (createFamilyNote).
  const currentUserId = me.data?.sub;
  const loadJournalEntries = useCallback(async () => loadJournal(await getToken()), [getToken]);
  const createFamilyEntry = useCallback(
    async (input: {
      figureType: string;
      danceScope: string;
      kind: "note" | "lesson" | "practice";
      text: string;
    }) => {
      await createFamilyNote(input, await getToken());
    },
    [getToken],
  );
  const createRoutineEntry = useCallback(
    async (
      routineRef: string,
      input: { kind: "note" | "lesson" | "practice"; text: string; anchors: unknown[] },
    ) => {
      await createRoutineJournalEntry(
        routineRef,
        { kind: input.kind, text: input.text, anchors: input.anchors as never },
        { getToken: () => getToken(), currentUserId },
      );
    },
    [getToken, currentUserId],
  );
  const loadJournalRoutineOptions = useCallback(
    async () => loadRoutineOptions(await getToken()),
    [getToken],
  );
  const loadJournalRoutineFigures = useCallback(
    async (routineRef: string) => loadRoutineFigureOptions(routineRef, await getToken()),
    [getToken],
  );
  const openRoutineId = route.name === "routine" ? route.id : undefined;
  // First-run nudge: a signed-in user who hasn't set a name/colour yet (US-019)
  // is pointed at Profile, so they aren't shown as a raw id to co-editors.
  const needsOnboarding =
    isSignedIn && me.data?.onboarded === false && tab !== "profile" && route.name !== "invite";

  // Hold the marketing Landing until auth resolves so a signed-in user is taken
  // straight to the choreo list instead of flashing the logged-out page.
  const gate = appGate(isLoaded, isSignedIn, route.name);
  if (gate === "loading") return <AuthLoading />;
  if (gate === "landing") return <Landing />;

  return (
    <AppShell
      nav={NAV}
      current={tab}
      onNavigate={(t) => {
        setTab(t);
        navigate("/"); // leaving an open routine returns to the list
      }}
    >
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
        {route.name === "invite" ? (
          // A share link (/invite/:token). Signed in → redeem + open the routine.
          // Signed out → a sign-in prompt that returns here after auth (so the
          // shared routine opens), NOT the generic dead-end card that has no
          // sign-in control and never mentions the shared routine.
          isSignedIn ? (
            <InviteRedeem token={route.token} />
          ) : (
            <SignInPrompt invited />
          )
        ) : !isSignedIn ? (
          <SignInPrompt />
        ) : openRoutineId || tab === "choreo" ? (
          <ChoreoFlow openRoutineId={openRoutineId} />
        ) : tab === "library" ? (
          <>
            <Tabs
              label="Library view"
              items={[
                { value: "all", label: "Catalog" },
                { value: "mine", label: "My figures" },
              ]}
              value={libTab}
              onChange={(v) => setLibTab(v as "all" | "mine")}
            />
            <FigureLibrary
              tab={libTab}
              loadMine={loadMine}
              onSaveToLibrary={onSaveToLibrary}
              onViewMine={() => setLibTab("mine")}
            />
          </>
        ) : tab === "journal" ? (
          <Journal
            loadEntries={loadJournalEntries}
            createFamilyEntry={createFamilyEntry}
            createRoutineEntry={createRoutineEntry}
            loadRoutineOptions={loadJournalRoutineOptions}
            loadRoutineFigures={loadJournalRoutineFigures}
            currentUserId={currentUserId}
          />
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

/**
 * Neutral full-screen state shown while auth resolves. Renders neither the
 * marketing Landing nor the app shell, so the signed-in/out decision is made
 * exactly once — no logged-out flash for a returning signed-in user.
 */
function AuthLoading(): React.JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface text-ink-muted">
      <Spinner size={24} label="Loading Ballroom Flow" />
    </div>
  );
}
