import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import { useMe } from "./store/me";

export function App() {
  return (
    <div style={{ font: "16px system-ui", padding: 24 }}>
      <h1>Ballroom Flow</h1>
      <SignedOut>
        <SignInButton />
      </SignedOut>
      <SignedIn>
        <UserButton />
        <CurrentUser />
      </SignedIn>
    </div>
  );
}

function CurrentUser() {
  const { data, isLoading, error } = useMe();
  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Could not load your profile.</p>;
  return (
    <p>
      Signed in as <code>{data?.sub}</code>
    </p>
  );
}
