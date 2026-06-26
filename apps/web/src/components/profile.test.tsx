import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// US-053 — Account / profile + plan status [M3, user]
// US-038 — Per-user undo / redo UX [M5, user] (toast surface)
//
// PLAN §4.8, §4.9, §10.2 component layer: profile (plan/owned count); toasts
// incl. "Undone". Built by the frontend agent → dynamic import behind it.skip.
// (Two-client undo convergence is the E2E test; here we pin the UI surface.)
// ─────────────────────────────────────────────────────────────────────────

interface ProfileModule {
  Profile: ComponentType<Record<string, unknown>>;
}
describe("US-053 Account / profile + plan status", () => {
  it("shows the plan + owned-routine count and edits the display name", async () => {
    // Intent: the profile shows plan/quota and edits identity.
    // Covers US-053 AC-1 (edit name) + AC-2 (plan + owned count).
    const { Profile } = await importComponent<ProfileModule>("../components/Profile");
    renderUi(<Profile plan="free" ownedRoutineCount={2} />);
    expect(screen.getByText(/free plan/i)).toBeInTheDocument();
    expect(screen.getByText(/2 routines|owned: 2/i)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/display name/i));
    await userEvent.type(screen.getByLabelText(/display name/i), "Dancer");
    expect(screen.getByLabelText(/display name/i)).toHaveValue("Dancer");
  });

  it("saves the edited display name + identity colour via onSave", async () => {
    // Intent: editing name/colour persists through the store seam (onboarding).
    // Covers US-053 AC-1 (persist identity).
    const { Profile } = await importComponent<ProfileModule>("../components/Profile");
    const onSave = vi.fn();
    renderUi(<Profile plan="free" ownedRoutineCount={0} displayName="Old" onSave={onSave} />);
    await userEvent.clear(screen.getByLabelText(/display name/i));
    await userEvent.type(screen.getByLabelText(/display name/i), "Dancer");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith("Dancer", expect.stringMatching(/^#[0-9a-fA-F]{3,8}$/));
  });

  it("signs out via onSignOut (AC-3)", async () => {
    // Intent: a Sign out control fires the sign-out callback.
    const { Profile } = await importComponent<ProfileModule>("../components/Profile");
    const onSignOut = vi.fn();
    renderUi(<Profile plan="free" ownedRoutineCount={0} onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

// US-038 Per-user undo / redo UX: the undo/redo affordances + "Undone" toast live
// on the OPEN routine (the Assemble header), not on a standalone <UndoControls> or
// the Profile — so the component coverage is in `assemble.test.tsx` (describe
// "US-038 Per-user undo / redo UX"). The two-client "only my change reverts;
// redo restores" proof is the E2E test (`undo.spec.ts`). AC-3 (the soft
// "superseded" hint) is deferred — see USER-STORIES.md US-038.
