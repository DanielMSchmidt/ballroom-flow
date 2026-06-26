import { describe, expect, it, vi } from "vitest";
import type { Member } from "../store/share";
import { renderUi, screen, userEvent } from "../test-support/render";
import { ToastProvider } from "../ui";
import { ShareView } from "./Share";

// ─────────────────────────────────────────────────────────────────────────
// US-024 — Share screen (member list + roles) [M3, user]
//
// The worker authorization + data is pinned at the worker layer (share.test.ts);
// here we pin the AC-4 PRESENTATION gap the story flags: the member roster shows
// each role; membership management (remove / invite) is gated on the viewer's own
// role (can(role,"canInvite"), principle #26); and the role microcopy explains
// the roles AND the shared-figure consequence (a shared-figure edit ripples to
// every routine, else make a variant — DESIGN-PRINCIPLES #15).
// ─────────────────────────────────────────────────────────────────────────

const MEMBERS: Member[] = [
  { userId: "u_co", role: "commenter" },
  { userId: "u_vw", role: "viewer" },
];

/** Render ShareView inside the Toast provider it relies on (app root provides it). */
function renderShare(props: Parameters<typeof ShareView>[0]) {
  return renderUi(
    <ToastProvider>
      <ShareView {...props} />
    </ToastProvider>,
  );
}

describe("US-024 Share screen (member list + roles)", () => {
  it("lists each member with their role (AC-1)", () => {
    renderShare({ viewerRole: "editor", members: MEMBERS });
    expect(screen.getByText("u_co")).toBeInTheDocument();
    expect(screen.getByText("u_vw")).toBeInTheDocument();
    // Roles are shown, not just the ids.
    expect(screen.getByText("Commenter")).toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
  });

  it("lets an editor remove a member, behind a destructive confirm (AC-2, DP #28)", async () => {
    const onRemove = vi.fn();
    renderShare({ viewerRole: "editor", members: MEMBERS, onRemove });

    // The remove affordance is present for an editor…
    await userEvent.click(screen.getByRole("button", { name: /remove u_co/i }));
    // …and it confirms before acting (no immediate removal).
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /remove access/i }));
    expect(onRemove).toHaveBeenCalledWith("u_co");
  });

  it("offers the invite-by-link affordance to an editor", () => {
    renderShare({ viewerRole: "editor", members: MEMBERS, onIssueInvite: vi.fn() });
    expect(screen.getByRole("button", { name: /create link/i })).toBeInTheDocument();
  });

  it("hides membership management from a viewer/commenter (gated per role, #26)", () => {
    renderShare({ viewerRole: "viewer", members: MEMBERS, onRemove: vi.fn() });
    // No remove control and no invite affordance for a non-managing role.
    expect(screen.queryByRole("button", { name: /remove u_co/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create link/i })).not.toBeInTheDocument();
    // …but they still see the roster + roles (read access).
    expect(screen.getByText("Commenter")).toBeInTheDocument();
  });

  it("explains the roles and the shared-figure consequence (DP #15)", () => {
    renderShare({ viewerRole: "editor", members: MEMBERS });
    // Role explanations (the microcopy that makes roles legible).
    expect(screen.getByText(/can add annotations, but not edit/i)).toBeInTheDocument();
    expect(screen.getByText(/can view the routine, read-only/i)).toBeInTheDocument();
    // The shared-figure ripple warning + the variant escape hatch (DP #15).
    expect(screen.getByText(/editing a shared figure changes it/i)).toBeInTheDocument();
    expect(screen.getByText(/make a variant instead/i)).toBeInTheDocument();
  });
});
