import { describe, expect, it } from "vitest";
import { can, capabilitiesFor } from "./permissions";

// ─────────────────────────────────────────────────────────────────────────
// US-020 — per-document capability model [M3, system]. PLAN §5.1.
// The pure role → capability table the worker REST surface, the DO sync
// boundary (US-021), and the web affordance-gating (#26) all share.
// ─────────────────────────────────────────────────────────────────────────

describe("US-020 capability model", () => {
  it("escalates capabilities viewer → commenter → editor → owner", () => {
    // Intent: each role is a strict superset of the one below it (delete = owner only).
    expect(capabilitiesFor("viewer")).toEqual({
      canRead: true,
      canAnnotate: false,
      canEdit: false,
      canInvite: false,
      canDelete: false,
    });
    expect(capabilitiesFor("commenter")).toMatchObject({
      canRead: true,
      canAnnotate: true,
      canEdit: false,
    });
    expect(capabilitiesFor("editor")).toMatchObject({
      canEdit: true,
      canInvite: true,
      canDelete: false,
    });
    expect(capabilitiesFor("owner")).toMatchObject({
      canEdit: true,
      canInvite: true,
      canDelete: true,
    });
  });

  it("can(role, action) gates a single capability", () => {
    // Intent: the one-call gate the layers use.
    expect(can("editor", "canInvite")).toBe(true);
    expect(can("commenter", "canEdit")).toBe(false);
    expect(can("viewer", "canAnnotate")).toBe(false);
    expect(can("owner", "canDelete")).toBe(true);
    expect(can("editor", "canDelete")).toBe(false); // delete is owner-only
  });
});
