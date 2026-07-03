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
    // Frame 4.2: roles shown as lowercase pills.
    expect(screen.getByText("commenter")).toBeInTheDocument();
    expect(screen.getByText("viewer")).toBeInTheDocument();
    // Section heading is "Partners on this routine" (uppercase via CSS).
    expect(screen.getByText(/partners on this choreo/i)).toBeInTheDocument();
  });

  it("shows displayName in the member row when available", () => {
    const membersWithName: Member[] = [
      { userId: "u_co", role: "commenter", displayName: "Coach Lena" },
    ];
    renderShare({ viewerRole: "editor", members: membersWithName });
    expect(screen.getByText("Coach Lena")).toBeInTheDocument();
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

  it("offers the invite-by-link affordance to an editor via '+ invite someone'", async () => {
    renderShare({ viewerRole: "editor", members: MEMBERS, onIssueInvite: vi.fn() });
    // Frame 4.2: invite form is hidden behind "+ invite someone" button (CTA ③).
    await userEvent.click(screen.getByRole("button", { name: /\+ invite someone/i }));
    expect(screen.getByRole("button", { name: /create link/i })).toBeInTheDocument();
  });

  it("hides membership management from a viewer/commenter (gated per role, #26)", () => {
    renderShare({ viewerRole: "viewer", members: MEMBERS, onRemove: vi.fn() });
    // No remove control and no invite affordance for a non-managing role.
    expect(screen.queryByRole("button", { name: /remove u_co/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invite someone/i })).not.toBeInTheDocument();
    // …but they still see the roster + roles (read access).
    expect(screen.getByText("commenter")).toBeInTheDocument();
  });

  it("explains the roles and the shared-figure consequence (DP #15)", () => {
    renderShare({ viewerRole: "editor", members: MEMBERS });
    // Role blurbs (the microcopy that makes roles legible).
    expect(screen.getByText(/can add annotations, but not edit/i)).toBeInTheDocument();
    expect(screen.getByText(/can view the choreo, read-only/i)).toBeInTheDocument();
    // The shared-figure ripple warning (DP #15) — info card copy (no variant line
    // in frame 4.2 — card was trimmed to the fork CTA).
    expect(screen.getByText(/everyone on this choreo edits the same figures/i)).toBeInTheDocument();
  });

  // ───────────────────────────────────────────────────────────────────────
  // T7 — Share design parity (frame 4.2): a per-screen header, the dark
  // "Fork — make it your own" CTA (a frozen, independent copy), and the
  // current viewer surfaced as the "you" row.
  // ───────────────────────────────────────────────────────────────────────
  it("shows a Share header with the routine name as the subtitle (frame 4.2)", () => {
    renderShare({ viewerRole: "editor", members: MEMBERS, routineName: "Gold Waltz" });
    expect(screen.getByRole("heading", { name: "Share" })).toBeInTheDocument();
    expect(screen.getByText("Gold Waltz")).toBeInTheDocument();
  });

  it("offers a Fork CTA that forks an independent copy", async () => {
    const onFork = vi.fn();
    renderShare({ viewerRole: "commenter", members: MEMBERS, onFork });
    const fork = screen.getByRole("button", { name: /fork/i });
    await userEvent.click(fork);
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  it("surfaces the current viewer as the 'you' row with their role", () => {
    renderShare({
      viewerRole: "owner",
      members: MEMBERS,
      viewer: { userId: "u_me", displayName: "Daniel" },
    });
    expect(screen.getByText("Daniel")).toBeInTheDocument();
    expect(screen.getByText(/you · owner/i)).toBeInTheDocument();
  });
});
