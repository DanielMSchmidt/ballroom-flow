// US-053 — Account / profile + plan status. PLAN §4.8. Lets a user set their
// identity (display name + note colour — the same call as first-run onboarding,
// POST /api/onboarding), see their plan + owned-routine count against the cap,
// and sign out. Presentational `Profile` (data + handlers as props, the §3 seam)
// is wired by `ProfileScreen` to the store (me + routines + onboarding + auth).
import { useEffect, useState } from "react";
import { useAppAuth } from "../auth/app-auth";
import { useMe, useOnboard } from "../store/me";
import { useRoutines } from "../store/routines";
import { Badge, Button, Card, Input } from "../ui";

/** The six identity-colour swatches (PLAN §4.8 — colour is consistent per user). */
const SWATCHES = ["#e23d3d", "#e2873d", "#e2c63d", "#3dc06b", "#3da0e2", "#9b5de5"] as const;

export interface ProfileProps {
  displayName?: string;
  identityColor?: string;
  plan: "free" | "pro";
  ownedRoutineCount: number;
  routineCap?: number;
  /** Persist name + colour (the onboarding endpoint). */
  onSave?: (displayName: string, identityColor: string) => void;
  /** Sign the user out. */
  onSignOut?: () => void;
  /** A save is in flight. */
  saving?: boolean;
}

export function Profile({
  displayName,
  identityColor,
  plan,
  ownedRoutineCount,
  routineCap,
  onSave,
  onSignOut,
  saving,
}: ProfileProps) {
  const [name, setName] = useState(displayName ?? "");
  const [color, setColor] = useState<string>(identityColor ?? SWATCHES[0]);
  // Adopt server values once they load (the query resolves after first render).
  useEffect(() => {
    if (displayName !== undefined) setName(displayName);
  }, [displayName]);
  useEffect(() => {
    if (identityColor) setColor(identityColor);
  }, [identityColor]);

  const routineWord = ownedRoutineCount === 1 ? "routine" : "routines";

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Profile</h1>
        <Badge tone={plan === "pro" ? "accent" : "neutral"}>
          {plan === "pro" ? "Pro plan" : "Free plan"}
        </Badge>
      </header>

      <p className="text-2xs text-ink-muted">
        You own {ownedRoutineCount} {routineWord}
        {plan === "free" && routineCap ? ` of ${routineCap}` : ""}.
      </p>

      <Input
        label="Display name"
        placeholder="How you appear to co-editors"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <fieldset aria-label="Identity colour" className="flex flex-col gap-2">
        <span className="text-2xs font-semibold text-ink-muted">Note colour</span>
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Use colour ${swatch}`}
              aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
              onClick={() => setColor(swatch)}
              className="size-9 rounded-full border-2"
              style={{
                backgroundColor: swatch,
                borderColor: color.toLowerCase() === swatch.toLowerCase() ? "#111" : "transparent",
              }}
            />
          ))}
        </div>
      </fieldset>

      {/* Preview: how this user's identity reads to others (colour + initial). */}
      <Card>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {(name.trim()[0] ?? "?").toUpperCase()}
          </span>
          <span className="text-2xs text-ink-secondary">This is how your notes appear.</span>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="primary"
          loading={saving}
          disabled={!name.trim()}
          onClick={() => onSave?.(name.trim(), color)}
        >
          Save
        </Button>
        <Button variant="ghost" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

/** Wire the Profile screen to the store (identity + plan + owned count + auth). */
export function ProfileScreen() {
  const me = useMe();
  const routinesQ = useRoutines();
  const onboard = useOnboard();
  const { signOut } = useAppAuth();
  const owned = (routinesQ.data?.routines ?? []).filter((r) => r.role === "owner").length;
  return (
    <Profile
      displayName={me.data?.displayName}
      identityColor={me.data?.identityColor}
      plan={me.data?.plan ?? "free"}
      ownedRoutineCount={owned}
      routineCap={me.data?.routineCap}
      saving={onboard.isPending}
      onSave={(displayName, identityColor) => onboard.mutate({ displayName, identityColor })}
      onSignOut={() => void signOut()}
    />
  );
}
