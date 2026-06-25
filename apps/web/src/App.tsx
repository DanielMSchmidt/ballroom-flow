import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import { useState } from "react";
import { useMe } from "./store/me";
import { Styleguide } from "./styleguide/Styleguide";
import { AppShell, Button, Card, type NavItem, ToastProvider } from "./ui";
import { JournalIcon, LibraryIcon, PersonIcon, StepsIcon } from "./ui/icons";

/**
 * Is the styleguide route active? Routing is kept trivial at the
 * design-system stage (no router dependency yet): the gallery is
 * reachable at `/styleguide` or `#styleguide`. Real screens land in a
 * later milestone.
 */
function isStyleguideRoute(): boolean {
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

export function App() {
  return <ToastProvider>{isStyleguideRoute() ? <Styleguide /> : <AppHome />}</ToastProvider>;
}

/**
 * AppHome — the signed-in/out shell using the AppShell primitive. The
 * Clerk auth surface is preserved; real product screens replace the
 * placeholder content in a later milestone.
 */
function AppHome() {
  const [tab, setTab] = useState("choreo");
  return (
    <AppShell nav={NAV} current={tab} onNavigate={setTab}>
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 lg:border-b-0 lg:px-0">
        <h1 className="text-lg font-bold tracking-tight text-ink lg:hidden">Ballroom Flow</h1>
        <div className="ml-auto flex items-center gap-2">
          <SignedOut>
            <SignInButton />
          </SignedOut>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4 lg:p-0 lg:pt-4">
        <SignedIn>
          <CurrentUser />
        </SignedIn>
        <Card>
          <p className="text-sm font-bold text-ink">Design system ready</p>
          <p className="mt-1 text-2xs text-ink-muted">
            Product screens land in a later milestone. Preview the primitives in the styleguide.
          </p>
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                window.location.hash = "styleguide";
                window.location.reload();
              }}
            >
              Open the styleguide
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function CurrentUser() {
  const { data, isLoading, error } = useMe();
  if (isLoading) return <p className="text-2xs text-ink-muted">Loading your profile…</p>;
  if (error) return <p className="text-2xs text-danger-ink">Could not load your profile.</p>;
  return (
    <p className="text-2xs text-ink-muted">
      Signed in as <code className="text-ink">{data?.sub}</code>
    </p>
  );
}
