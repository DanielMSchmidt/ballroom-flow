import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderUi, screen, userEvent } from "../test-support/render";
import { InviteRedeem } from "./InviteRedeem";

// ─────────────────────────────────────────────────────────────────────────
// US-023 × US-022 — invite redeem, with the editor→commenter downgrade notice.
// When a free user already at their editable-routine limit accepts an EDITOR
// invite, the server grants commenter and flags `downgraded`. The redeem screen
// must NOT silently drop them into a read-only routine — it shows a notice
// explaining what happened before they continue.
// ─────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  // Annotated (not asserted) so tests can reassign role/requestedRole per case.
  const result: {
    docRef: string;
    role: "editor" | "commenter" | "viewer";
    requestedRole: "editor" | "commenter" | "viewer";
    downgraded: boolean;
  } = { docRef: "rt9", role: "editor", requestedRole: "editor", downgraded: false };
  return { isError: false, result };
});

// Replace the store seam: drive onSuccess synchronously with a controllable
// redeem result (no network, no real React Query mutation). `h.isError` flips
// the seam into its error state (expired/invalid/used) without calling onSuccess.
vi.mock("../store/invites", () => ({
  useRedeemInvite: () => ({
    isError: h.isError,
    mutate: (_token: string, opts?: { onSuccess?: (res: typeof h.result) => void }) => {
      if (!h.isError) opts?.onSuccess?.(h.result);
    },
  }),
}));

// The router seam — assert the escape-hatch button navigates to the overview.
const nav = vi.hoisted(() => ({ to: vi.fn() }));
vi.mock("../lib/router", () => ({ navigate: nav.to }));

describe("InviteRedeem downgrade notice", () => {
  beforeEach(() => {
    h.isError = false;
    nav.to.mockClear();
    h.result = { docRef: "rt9", role: "editor", requestedRole: "editor", downgraded: false };
  });

  it("shows a commenter-downgrade notice when the editor invite was downgraded", async () => {
    h.result = { docRef: "rt9", role: "commenter", requestedRole: "editor", downgraded: true };
    renderUi(<InviteRedeem token="tok" />);
    // A clear notice — joined, but as a commenter, because of the edit limit.
    expect(await screen.findByText(/joined as a commenter/i)).toBeInTheDocument();
    expect(screen.getByText(/limit/i)).toBeInTheDocument();
    // …and an explicit way to continue into the routine.
    expect(screen.getByRole("button", { name: /open choreo/i })).toBeInTheDocument();
  });

  it("does NOT show the downgrade notice on a normal (non-downgraded) redeem", async () => {
    h.result = { docRef: "rt9", role: "editor", requestedRole: "editor", downgraded: false };
    renderUi(<InviteRedeem token="tok" />);
    expect(screen.queryByText(/joined as a commenter/i)).not.toBeInTheDocument();
  });

  // An expired/invalid/used invite must NOT strand the (now signed-in) visitor:
  // the error card offers an explicit button back to their choreography overview.
  it("offers a button back to the choreography overview when the invite can't be opened", async () => {
    h.isError = true;
    renderUi(<InviteRedeem token="tok" />);
    expect(await screen.findByText(/this invite can’t be opened/i)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /go to my choreography/i });
    await userEvent.click(button);
    // Navigates to the overview (the routine list at `/`), never a dead end.
    expect(nav.to).toHaveBeenCalledWith("/");
  });
});
