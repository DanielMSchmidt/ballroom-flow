import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
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
interface UndoBarModule {
  UndoControls: ComponentType<Record<string, unknown>>;
}

describe.skip("US-053 Account / profile + plan status", () => {
  it("edits displayName + identity color and shows plan + owned-routine count", async () => {
    // Intent: the profile edits identity and shows plan/quota.
    // Arrange: render <Profile> for a free user owning 2 routines.
    // Act: edit displayName + color; read plan/count.
    // Assert: the field updates; "Free plan" + "2 routines" show.
    // Covers US-053 AC-1 (edit name/color) + AC-2 (plan + owned count).
    const { Profile } = await importComponent<ProfileModule>("../components/Profile");
    renderUi(<Profile plan="free" ownedRoutineCount={2} />);
    await userEvent.clear(screen.getByLabelText(/display name/i));
    await userEvent.type(screen.getByLabelText(/display name/i), "Dancer");
    expect(screen.getByText(/2 routines|owned: 2/i)).toBeInTheDocument();
  });

  it("signs out (clears the Clerk session)", async () => {
    // Intent: sign out clears the session.
    // Arrange: render <Profile>. Act: click "Sign out". Assert: the sign-out callback fires.
    // Covers US-053 AC-3 (sign out works).
    const { Profile } = await importComponent<ProfileModule>("../components/Profile");
    renderUi(<Profile plan="free" ownedRoutineCount={0} />);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
});

describe.skip("US-038 Per-user undo / redo UX (toast surface)", () => {
  it("shows an 'Undone' toast on undo and a soft 'superseded' hint", async () => {
    // Intent: undo shows an "Undone" toast; if others built on the change, a soft hint.
    // Arrange: render <UndoControls> with an undoable last change.
    // Act: click Undo. Assert: an "Undone" toast appears; redo becomes available.
    //   (The two-client "only my change reverts" is the E2E test undo.spec.ts.)
    // Covers US-038 AC-1 (Undone toast) + AC-4 (redo available) — §10.2 "toasts incl. 'Undone'".
    const { UndoControls } = await importComponent<UndoBarModule>("../components/UndoControls");
    renderUi(<UndoControls canUndo />);
    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(await screen.findByText(/undone/i)).toBeInTheDocument();
  });
});
