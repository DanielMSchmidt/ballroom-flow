import { describe, expect, it } from "vitest";
import { IDENTITY_HEX } from "../ui";
import { buildMemberColorMap, defaultIdentityColor } from "./identity-colors";

describe("identity colours — default assignment (US-039, DP #5)", () => {
  it("keeps a member's chosen colour", () => {
    const map = buildMemberColorMap([{ userId: "u1", identityColor: "#1f8a5b" }]);
    expect(map.u1).toBe("#1f8a5b");
  });

  it("gives profile-less co-members DISTINCT default colours (the reported bug)", () => {
    // Two logged-in members with no profile must not both fall back to slot 1.
    const map = buildMemberColorMap([{ userId: "alice" }, { userId: "bob" }]);
    expect(map.alice).not.toBe(map.bob);
    // Both come from the canonical palette (usable as hex avatar/note tints).
    expect(IDENTITY_HEX).toContain(map.alice);
    expect(IDENTITY_HEX).toContain(map.bob);
  });

  it("a profile-less member avoids a colour another member already chose", () => {
    // `probe` hashes to slot 0 (#3b7dd8); a chosen member holding that slot forces
    // the default to move to a different colour.
    const chosen = IDENTITY_HEX[0];
    const map = buildMemberColorMap([
      { userId: "chooser", identityColor: chosen },
      { userId: "probe" },
    ]);
    expect(map.chooser).toBe(chosen);
    expect(map.probe).not.toBe(chosen);
  });

  it("is deterministic — same roster yields the same assignment", () => {
    const roster = [{ userId: "x" }, { userId: "y" }, { userId: "z" }];
    expect(buildMemberColorMap(roster)).toEqual(buildMemberColorMap(roster));
  });

  it("defaultIdentityColor is stable per user id", () => {
    expect(defaultIdentityColor("same-user")).toBe(defaultIdentityColor("same-user"));
  });

  it("wraps gracefully when there are more members than palette slots", () => {
    const many = Array.from({ length: IDENTITY_HEX.length + 3 }, (_, i) => ({
      userId: `member-${i}`,
    }));
    const map = buildMemberColorMap(many);
    // Every member still gets a real palette colour (no undefined / crash).
    for (const m of many) expect(IDENTITY_HEX).toContain(map[m.userId]);
  });
});
