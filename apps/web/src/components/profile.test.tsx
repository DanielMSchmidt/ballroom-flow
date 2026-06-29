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

// ─────────────────────────────────────────────────────────────────────────
// T7 — Profile design parity (frame 4.1). The profile-colour picker is the
// identity colour that tints every note/reply across shared routines; it's the
// six IDENTITY_COLORS slots (not an ad-hoc palette), and it persists the chosen
// colour as the hex the onboarding endpoint stores (§4.8, server validates hex).
// ─────────────────────────────────────────────────────────────────────────
describe("T7 Profile design parity (frame 4.1)", () => {
  it("labels the profile colour and explains it tints every note across shared routines", async () => {
    const { Profile } = await importComponent<ProfileModule>("../components/Profile");
    renderUi(<Profile plan="free" ownedRoutineCount={0} />);
    expect(screen.getByText(/profile colour/i)).toBeInTheDocument();
    // The tint microcopy (DP #5: colour carries authorship across shared routines).
    expect(screen.getByText(/tinted with this/i)).toBeInTheDocument();
    expect(screen.getByText(/shared routines/i)).toBeInTheDocument();
  });

  it("offers exactly the six identity-colour swatches", async () => {
    const { Profile } = await importComponent<ProfileModule>("../components/Profile");
    renderUi(<Profile plan="free" ownedRoutineCount={0} />);
    expect(screen.getAllByRole("button", { name: /use colou?r/i })).toHaveLength(6);
  });

  it("persists the picked swatch as a hex identity colour via onSave", async () => {
    const { Profile } = await importComponent<ProfileModule>("../components/Profile");
    const onSave = vi.fn();
    renderUi(<Profile plan="free" ownedRoutineCount={0} displayName="Daniel" onSave={onSave} />);
    const swatches = screen.getAllByRole("button", { name: /use colou?r/i });
    const third = swatches[2]; // pick the third identity slot
    if (!third) throw new Error("expected six identity swatches");
    await userEvent.click(third);
    expect(third).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith("Daniel", expect.stringMatching(/^#[0-9a-fA-F]{3,8}$/));
  });

  it("clarifies that Leader/Follower is a per-figure timeline toggle, not a profile setting", async () => {
    const { Profile } = await importComponent<ProfileModule>("../components/Profile");
    renderUi(<Profile plan="free" ownedRoutineCount={0} />);
    expect(screen.getByText(/leader\s*\/\s*follower/i)).toBeInTheDocument();
    expect(screen.getByText(/per-figure/i)).toBeInTheDocument();
    expect(screen.getByText(/not a profile setting/i)).toBeInTheDocument();
  });

  it("renders the identity avatar with the user's initial", async () => {
    const { Profile } = await importComponent<ProfileModule>("../components/Profile");
    renderUi(<Profile plan="free" ownedRoutineCount={0} displayName="Daniel" />);
    expect(screen.getAllByText("D").length).toBeGreaterThan(0);
  });
});

// US-038 Per-user undo / redo UX: the undo/redo affordances + "Undone" toast live
// on the OPEN routine (the Assemble header), not on a standalone <UndoControls> or
// the Profile — so the component coverage is in `assemble.test.tsx` (describe
// "US-038 Per-user undo / redo UX"). The two-client "only my change reverts;
// redo restores" proof is the E2E test (`undo.spec.ts`). AC-3 (the soft
// "superseded" hint) is deferred — see USER-STORIES.md US-038.
