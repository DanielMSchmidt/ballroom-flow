// US-053 — Account / profile + plan status. PLAN §4.8. Lets a user set their
// identity (display name + note colour — the same call as first-run onboarding,
// POST /api/onboarding), see their plan + owned-routine count against the cap,
// and sign out. Presentational `Profile` (data + handlers as props, the §3 seam)
// is wired by `ProfileScreen` to the store (me + routines + onboarding + auth).
//
// T7 design parity (frame 4.1): a centred identity avatar + editable name, then
// the PROFILE COLOUR picker — the six canonical IDENTITY_COLORS slots — that
// tints every note & reply of yours across shared routines (DP #5). Leader /
// Follower is deliberately *not* here: it's a per-figure timeline toggle.
import type { RegistryKind } from "@ballroom/domain";
import { useEffect, useState } from "react";
import { useAppAuth } from "../auth/app-auth";
import { useAccountKinds, useSaveAccountKind } from "../store/custom-kinds";
import { useMe, useOnboard } from "../store/me";
import { useRoutines } from "../store/routines";
import { Badge, Button, Card, IDENTITY_COLORS, IDENTITY_HEX, Input, ScreenHeader } from "../ui";
import { AttributeTypesManager } from "./AttributeTypesManager";

/**
 * The six identity-colour swatches (PLAN §4.8 — colour is consistent per user).
 * Each pairs the design *token* (a CSS variable, used to paint the swatch so the
 * UI never hardcodes a palette hex) with the canonical hex the onboarding
 * endpoint persists — the server validates identityColor as `^#…` and authorship
 * tint reads back as that hex. Hex values come from `IDENTITY_HEX` in tokens.ts,
 * which mirrors `--bf-identity-1..6` in `styles/tokens.css` (single source of truth).
 */
const IDENTITY_SWATCHES = [
  { token: IDENTITY_COLORS[0], value: IDENTITY_HEX[0] },
  { token: IDENTITY_COLORS[1], value: IDENTITY_HEX[1] },
  { token: IDENTITY_COLORS[2], value: IDENTITY_HEX[2] },
  { token: IDENTITY_COLORS[3], value: IDENTITY_HEX[3] },
  { token: IDENTITY_COLORS[4], value: IDENTITY_HEX[4] },
  { token: IDENTITY_COLORS[5], value: IDENTITY_HEX[5] },
] as const;

const DEFAULT_COLOR = IDENTITY_SWATCHES[0].value;

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
  /** Custom (choreo-scoped) attribute kinds for the types manager (frame 1.17). */
  customKinds?: RegistryKind[];
  /** Persist a newly-built custom attribute kind. */
  onCreateKind?: (kind: RegistryKind) => void;
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
  customKinds,
  onCreateKind,
}: ProfileProps) {
  const [name, setName] = useState(displayName ?? "");
  const [color, setColor] = useState<string>(identityColor ?? DEFAULT_COLOR);
  // Adopt server values once they load (the query resolves after first render).
  useEffect(() => {
    if (displayName !== undefined) setName(displayName);
  }, [displayName]);
  useEffect(() => {
    if (identityColor) setColor(identityColor);
  }, [identityColor]);

  const routineWord = ownedRoutineCount === 1 ? "choreo" : "choreos";
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="flex flex-col">
      <ScreenHeader title="Profile" />

      <div className="flex flex-col gap-6 p-4">
        {/* Identity: avatar (initial on the user's colour) + editable name. */}
        <section className="flex flex-col items-center gap-3 pt-2">
          <span
            aria-hidden="true"
            className="flex size-24 items-center justify-center rounded-full text-4xl font-bold text-ink-inverse"
            style={{ backgroundColor: color }}
          >
            {initial}
          </span>
          <Input
            label="Display name"
            hideLabel
            placeholder="How you appear to co-editors"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-center text-lg font-bold"
          />
        </section>

        {/* PROFILE COLOUR — the identity tint applied to every note/reply (DP #5). */}
        <fieldset className="flex flex-col gap-3">
          <legend className="text-2xs font-bold uppercase tracking-wide text-ink-muted">
            Profile colour
          </legend>
          <p className="text-2xs italic text-ink-secondary">
            Every note &amp; reply of yours is tinted with this, across shared choreos.
          </p>
          <div className="flex flex-wrap gap-3">
            {IDENTITY_SWATCHES.map((swatch, i) => {
              const selected = color.toLowerCase() === swatch.value.toLowerCase();
              return (
                <button
                  key={swatch.value}
                  type="button"
                  aria-label={`Use colour ${i + 1}`}
                  aria-pressed={selected}
                  onClick={() => setColor(swatch.value)}
                  className="relative flex size-10 items-center justify-center rounded-full border-2 transition-colors"
                  style={{
                    backgroundColor: swatch.token,
                    borderColor: selected ? "var(--bf-ink)" : "transparent",
                  }}
                >
                  {selected && (
                    <span aria-hidden="true" className="text-sm font-bold text-ink-inverse">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Preview: how this user's notes read to others (colour + initial). */}
          <Card className="flex items-center gap-3" style={{ borderLeftColor: color }}>
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-ink-inverse"
              style={{ backgroundColor: color }}
            >
              {initial}
            </span>
            <span className="text-2xs text-ink-secondary">This is how your notes appear.</span>
          </Card>

          {/* Leader/Follower is a per-figure timeline toggle, not identity (DP #11). */}
          <p className="text-2xs italic text-ink-faint">
            Leader / Follower is a per-figure timeline toggle (remembered between sessions), not a
            profile setting.
          </p>
        </fieldset>

        {/* Plan + owned/cap count (US-053 AC-2).
            D7: show "Free · N of M routines" status when plan + cap are known (design 1.18). */}
        <section className="flex items-center justify-between gap-2 border-t border-border-subtle pt-4">
          <p className="text-2xs text-ink-muted">
            {plan === "free" && routineCap != null
              ? `Free · ${ownedRoutineCount} of ${routineCap} choreos`
              : `You own ${ownedRoutineCount} ${routineWord}${plan === "free" && routineCap ? ` of ${routineCap}` : ""}.`}
          </p>
          <Badge tone={plan === "pro" ? "accent" : "neutral"}>
            {plan === "pro" ? "Pro plan" : "Free plan"}
          </Badge>
        </section>

        {/* Attribute types manager (frame 1.17) — a SECTION below identity, not a
            replacement: standard (locked) + custom (choreo-scoped) kinds. */}
        <AttributeTypesManager customKinds={customKinds} onCreateKind={onCreateKind} />

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

  // Account-wide custom attribute kinds for the types manager (frame 1.17).
  // A React Query read (deterministic caching/retry) through the store seam,
  // not a hand-rolled effect; `?? []` keeps the manager rendering pre-resolve.
  const accountKinds = useAccountKinds();
  const saveKind = useSaveAccountKind();

  return (
    <Profile
      displayName={me.data?.displayName}
      identityColor={me.data?.identityColor}
      plan={me.data?.plan ?? "free"}
      ownedRoutineCount={owned}
      routineCap={me.data?.routineCap}
      saving={onboard.isPending}
      customKinds={accountKinds.data ?? []}
      onCreateKind={(kind) => saveKind.mutate(kind)}
      onSave={(displayName, identityColor) => onboard.mutate({ displayName, identityColor })}
      onSignOut={() => void signOut()}
    />
  );
}
