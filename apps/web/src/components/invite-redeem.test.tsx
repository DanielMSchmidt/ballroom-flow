import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderUi, screen } from "../test-support/render";
import { InviteRedeem } from "./InviteRedeem";

// ─────────────────────────────────────────────────────────────────────────
// US-023 × US-022 — invite redeem, with the editor→commenter downgrade notice.
// When a free user already at their editable-routine limit accepts an EDITOR
// invite, the server grants commenter and flags `downgraded`. The redeem screen
// must NOT silently drop them into a read-only routine — it shows a notice
// explaining what happened before they continue.
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  result: {
    docRef: "rt9",
    role: "editor" as "editor" | "commenter" | "viewer",
    requestedRole: "editor" as "editor" | "commenter" | "viewer",
    downgraded: false,
  },
}));

// Replace the store seam: drive onSuccess synchronously with a controllable
// redeem result (no network, no real React Query mutation).
vi.mock("../store/invites", () => ({
  useRedeemInvite: () => ({
    isError: false,
    mutate: (_token: string, opts?: { onSuccess?: (res: typeof h.result) => void }) =>
      opts?.onSuccess?.(h.result),
  }),
}));

describe("InviteRedeem downgrade notice", () => {
  beforeEach(() => {
    h.result = { docRef: "rt9", role: "editor", requestedRole: "editor", downgraded: false };
  });

  it("shows a commenter-downgrade notice when the editor invite was downgraded", async () => {
    h.result = { docRef: "rt9", role: "commenter", requestedRole: "editor", downgraded: true };
    renderUi(<InviteRedeem token="tok" />);
    // A clear notice — joined, but as a commenter, because of the edit limit.
    expect(await screen.findByText(/joined as a commenter/i)).toBeInTheDocument();
    expect(screen.getByText(/limit/i)).toBeInTheDocument();
    // …and an explicit way to continue into the routine.
    expect(screen.getByRole("button", { name: /open routine/i })).toBeInTheDocument();
  });

  it("does NOT show the downgrade notice on a normal (non-downgraded) redeem", async () => {
    h.result = { docRef: "rt9", role: "editor", requestedRole: "editor", downgraded: false };
    renderUi(<InviteRedeem token="tok" />);
    expect(screen.queryByText(/joined as a commenter/i)).not.toBeInTheDocument();
  });
});
