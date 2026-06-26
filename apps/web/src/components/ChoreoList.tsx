// US-022 — Choreo list: create a routine, with the quota upsell.
//
// The free plan owns at most FREE_ROUTINE_CAP routines (D21). The server is the
// source of truth and refuses the 4th create with an upsell (POST /api/routines
// → 402 {upsell}); this screen mirrors the cap for INSTANT feedback so a capped
// user sees the upsell without a round-trip, and still calls the server for the
// allowed path. The sample/template empty state + the routine list itself are
// US-045/US-025 — this component is the create + quota slice.

import { useState } from "react";
import { Button, Sheet } from "../ui";

/** Free accounts may OWN at most this many routines (D21) — mirrors the server. */
const FREE_ROUTINE_CAP = 3;

export interface ChoreoListProps {
  /** How many routines the viewer OWNS (drives the quota gate). */
  ownedCount: number;
  /** The viewer's plan; only "free" is capped. */
  plan: "free" | "pro";
  /** Start a create (the allowed path). The screen wires this to the store. */
  onCreate?: () => void;
}

export function ChoreoList({ ownedCount, plan, onCreate }: ChoreoListProps) {
  const [upsellOpen, setUpsellOpen] = useState(false);
  const atCap = plan === "free" && ownedCount >= FREE_ROUTINE_CAP;

  const onNew = (): void => {
    // Mirror the server cap for instant feedback; the server still enforces it.
    if (atCap) {
      setUpsellOpen(true);
      return;
    }
    onCreate?.();
  };

  return (
    <section aria-label="Your choreography">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-medium text-ink">Choreography</h1>
        <Button variant="primary" onClick={onNew}>
          New Choreo
        </Button>
      </header>

      <Sheet
        open={upsellOpen}
        onClose={() => setUpsellOpen(false)}
        title="Upgrade for more routines"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-secondary">
            You've reached your free-plan cap of {FREE_ROUTINE_CAP} routines. A paid plan will let
            you create more — your existing routines stay exactly as they are.
          </p>
          {/* Billing is US-053; keep this honest rather than a dead live CTA —
              non-interactive so it sets expectations, not a fake upgrade path. */}
          <Button variant="secondary" disabled>
            Pro plans — coming soon
          </Button>
        </div>
      </Sheet>
    </section>
  );
}
