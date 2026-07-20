import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Attribute } from "./doc-types";
import {
  bothWriteTargets,
  deriveFollowerValue,
  isBothConsistent,
  splitSharedForRole,
} from "./role-write";
import { ATTRIBUTE_REGISTRY, type RegistryKind } from "./vocabulary";

// ─────────────────────────────────────────────────────────────────────────
// WEP-0008 (docs/concepts/notation.md § Role lenses) — role-scoped step editing with a Both write mode.
// A Both write stores the leader's value verbatim and DERIVES the follower's:
// direction/sway mirror (forward↔back, to_L↔to_R), footwork is leaderOnly
// (never derivable — heel/toe work is authored per role), every other kind
// copies (and a copy collapses to one shared role:null attribute). The Both
// lens may only edit derivation-consistent state — hand-authored divergence
// (the outside-swivel case) stays locked until a single role is selected.
// ─────────────────────────────────────────────────────────────────────────

const { direction, footwork, sway, rise, bodyActions } = ATTRIBUTE_REGISTRY;

/** A live attribute literal for a (kind, count, role, value). */
const attr = (
  kind: string,
  role: "leader" | "follower" | null,
  value: unknown,
  count = 1,
): Attribute => ({
  id: `${kind}-${count}-${String(value)}-${role ?? "both"}`,
  kind,
  count,
  role,
  value,
  deletedAt: null,
});

describe("role-write — deriveFollowerValue", () => {
  it("mirrors direction: forward↔back, diagonals, own-foot crosses", () => {
    expect(deriveFollowerValue(direction, "forward")).toBe("back");
    expect(deriveFollowerValue(direction, "back")).toBe("forward");
    expect(deriveFollowerValue(direction, "diagonal_forward")).toBe("diagonal_back");
    expect(deriveFollowerValue(direction, "diagonal_back")).toBe("diagonal_forward");
    expect(deriveFollowerValue(direction, "behind")).toBe("in_front");
    expect(deriveFollowerValue(direction, "in_front")).toBe("behind");
  });

  it("leaves symmetric directions unchanged (side/close/diagonal/in_place)", () => {
    for (const v of ["side", "close", "diagonal", "in_place"]) {
      expect(deriveFollowerValue(direction, v)).toBe(v);
    }
  });

  it("mirrors sway to_L↔to_R and keeps none", () => {
    expect(deriveFollowerValue(sway, "to_L")).toBe("to_R");
    expect(deriveFollowerValue(sway, "to_R")).toBe("to_L");
    expect(deriveFollowerValue(sway, "none")).toBe("none");
  });

  it("never derives footwork (leaderOnly)", () => {
    expect(deriveFollowerValue(footwork, "HT")).toBeUndefined();
    expect(deriveFollowerValue(footwork, "heel turn")).toBeUndefined();
  });

  it("copies every other kind verbatim (rise, bodyActions, custom)", () => {
    expect(deriveFollowerValue(rise, "commence")).toBe("commence");
    expect(deriveFollowerValue(bodyActions, "CBM")).toBe("CBM");
    const custom: RegistryKind = {
      kind: "energy",
      label: "Energy",
      color: "#888888",
      cardinality: "single",
      valueType: "enum",
      values: ["soft", "sharp"],
      builtin: false,
    };
    expect(deriveFollowerValue(custom, "sharp")).toBe("sharp");
  });

  it("derives the follower through an AUTHOR-supplied coupling on a custom kind", () => {
    // The coach's "poise" kind: leader forward pairs with follower back, upright
    // copies through (no row), and an unmapped value falls back to identity.
    const poise: RegistryKind = {
      kind: "poise",
      label: "Poise",
      color: "#888888",
      cardinality: "single",
      valueType: "enum",
      values: ["forward", "upright", "back"],
      roleAware: true,
      bothWrite: "mirror",
      coupling: { forward: "back" },
      builtin: false,
    };
    expect(deriveFollowerValue(poise, "forward")).toBe("back");
    // Unmapped leader values copy through (the existing `?? value` fallback).
    expect(deriveFollowerValue(poise, "upright")).toBe("upright");
    expect(deriveFollowerValue(poise, "back")).toBe("back");
  });

  it("built-in derivations are byte-identical after the mirror→coupling rename", () => {
    // Pins EVERY built-in Both-write output so the field rename can never silently
    // change behaviour — the exhaustive value × mode snapshot for direction, sway,
    // footwork (leaderOnly), and a copy kind (rise).
    const derivations = (kind: RegistryKind) =>
      (kind.values ?? []).map((v) => [v, deriveFollowerValue(kind, v), bothWriteTargets(kind, v)]);
    expect(derivations(direction)).toEqual([
      ["forward", "back", { leader: "forward", follower: "back" }],
      ["back", "forward", { leader: "back", follower: "forward" }],
      ["side", "side", { shared: "side" }],
      [
        "diagonal_forward",
        "diagonal_back",
        { leader: "diagonal_forward", follower: "diagonal_back" },
      ],
      [
        "diagonal_back",
        "diagonal_forward",
        { leader: "diagonal_back", follower: "diagonal_forward" },
      ],
      ["close", "close", { shared: "close" }],
      ["behind", "in_front", { leader: "behind", follower: "in_front" }],
      ["in_front", "behind", { leader: "in_front", follower: "behind" }],
      ["diagonal", "diagonal", { shared: "diagonal" }],
      ["in_place", "in_place", { shared: "in_place" }],
    ]);
    expect(derivations(sway)).toEqual([
      ["to_L", "to_R", { leader: "to_L", follower: "to_R" }],
      ["to_R", "to_L", { leader: "to_R", follower: "to_L" }],
      ["none", "none", { shared: "none" }],
    ]);
    // footwork is leaderOnly (follower never derived); rise is a copy kind.
    expect(deriveFollowerValue(footwork, "HT")).toBeUndefined();
    expect(bothWriteTargets(footwork, "HT")).toEqual({ leader: "HT" });
    expect(bothWriteTargets(rise, "up")).toEqual({ shared: "up" });
  });

  it("mirror maps are total involutions over the kind's enum", () => {
    for (const kind of [direction, sway]) {
      fc.assert(
        fc.property(fc.constantFrom(...(kind.values ?? [])), (v) => {
          const once = deriveFollowerValue(kind, v);
          expect(typeof once).toBe("string");
          expect(deriveFollowerValue(kind, String(once))).toBe(v);
        }),
      );
    }
  });
});

describe("role-write — bothWriteTargets", () => {
  it("splits an asymmetric mirror value into a leader/follower pair", () => {
    expect(bothWriteTargets(direction, "forward")).toEqual({
      leader: "forward",
      follower: "back",
    });
    expect(bothWriteTargets(sway, "to_R")).toEqual({ leader: "to_R", follower: "to_L" });
  });

  it("collapses a symmetric mirror value to one shared attribute", () => {
    expect(bothWriteTargets(direction, "side")).toEqual({ shared: "side" });
    expect(bothWriteTargets(sway, "none")).toEqual({ shared: "none" });
  });

  it("writes footwork for the leader only, follower left empty", () => {
    expect(bothWriteTargets(footwork, "H")).toEqual({ leader: "H" });
  });

  it("stores copy kinds as one shared value", () => {
    expect(bothWriteTargets(rise, "up")).toEqual({ shared: "up" });
  });

  it("keeps a presence write (value null) shared, even for mirror kinds", () => {
    expect(bothWriteTargets(direction, null)).toEqual({ shared: null });
  });

  it("splits/collapses through an author-supplied coupling map", () => {
    const poise: RegistryKind = {
      kind: "poise",
      label: "Poise",
      color: "#888888",
      cardinality: "single",
      valueType: "enum",
      values: ["forward", "upright", "back"],
      roleAware: true,
      bothWrite: "mirror",
      coupling: { forward: "back" },
      builtin: false,
    };
    // A mapped leader value writes a role-tagged pair.
    expect(bothWriteTargets(poise, "forward")).toEqual({ leader: "forward", follower: "back" });
    // An unmapped value copies through → one shared attribute.
    expect(bothWriteTargets(poise, "upright")).toEqual({ shared: "upright" });
  });
});

describe("role-write — isBothConsistent", () => {
  it("empty and shared-only states are editable under Both", () => {
    expect(isBothConsistent(direction, [])).toBe(true);
    expect(isBothConsistent(direction, [attr("direction", null, "forward")])).toBe(true);
    expect(isBothConsistent(footwork, [attr("footwork", null, "start with feet together")])).toBe(
      true,
    );
  });

  it("a derivation-consistent pair (Both's own output) stays editable", () => {
    expect(
      isBothConsistent(direction, [
        attr("direction", "leader", "forward"),
        attr("direction", "follower", "back"),
      ]),
    ).toBe(true);
    expect(
      isBothConsistent(sway, [attr("sway", "leader", "to_L"), attr("sway", "follower", "to_R")]),
    ).toBe(true);
  });

  it("hand-authored divergence is locked (the outside-swivel case)", () => {
    expect(
      isBothConsistent(direction, [
        attr("direction", "leader", "forward"),
        attr("direction", "follower", "side"),
      ]),
    ).toBe(false);
  });

  it("a lone role-tagged value with no counterpart is locked for mirror kinds", () => {
    expect(isBothConsistent(direction, [attr("direction", "leader", "forward")])).toBe(false);
  });

  it("footwork: leader-only is editable, any follower footwork locks", () => {
    expect(isBothConsistent(footwork, [attr("footwork", "leader", "H")])).toBe(true);
    expect(
      isBothConsistent(footwork, [
        attr("footwork", "leader", "TH"),
        attr("footwork", "follower", "H flat"),
      ]),
    ).toBe(false);
    expect(isBothConsistent(footwork, [attr("footwork", "follower", "heel turn")])).toBe(false);
  });

  it("locks a hand-diverged pair on a custom coupling kind, allows the derived pair", () => {
    const poise: RegistryKind = {
      kind: "poise",
      label: "Poise",
      color: "#888888",
      cardinality: "single",
      valueType: "enum",
      values: ["forward", "upright", "back"],
      roleAware: true,
      bothWrite: "mirror",
      coupling: { forward: "back" },
      builtin: false,
    };
    // The coupling's own output (leader forward / follower back) stays editable.
    expect(
      isBothConsistent(poise, [
        attr("poise", "leader", "forward"),
        attr("poise", "follower", "back"),
      ]),
    ).toBe(true);
    // The coach's deliberate exception (follower upright against a forward leader)
    // is hand-authored divergence and locks under Both.
    expect(
      isBothConsistent(poise, [
        attr("poise", "leader", "forward"),
        attr("poise", "follower", "upright"),
      ]),
    ).toBe(false);
  });

  it("copy kinds compare per-role views as sets (multi cardinality)", () => {
    const same = [
      attr("bodyActions", "leader", "CBM"),
      attr("bodyActions", "follower", "CBM"),
      attr("bodyActions", null, "shaping"),
    ];
    expect(isBothConsistent(bodyActions, same)).toBe(true);
    const diverged = [attr("bodyActions", "leader", "CBM"), attr("bodyActions", null, "shaping")];
    expect(isBothConsistent(bodyActions, diverged)).toBe(false);
  });

  it("tombstoned attributes do not count", () => {
    const dead = { ...attr("direction", "follower", "side"), deletedAt: 123 };
    expect(
      isBothConsistent(direction, [
        attr("direction", "leader", "forward"),
        attr("direction", "follower", "back"),
        dead,
      ]),
    ).toBe(true);
  });

  it("shared values alongside a consistent mirrored pair stay consistent only when symmetric", () => {
    // A shared "side" is its own mirror — each lens sees it, and each lens's view
    // is still the derivation of the other's.
    expect(
      isBothConsistent(direction, [
        attr("direction", null, "side"),
        attr("direction", "leader", "forward"),
        attr("direction", "follower", "back"),
      ]),
    ).toBe(true);
    // A shared "forward" next to role-tagged values is NOT symmetric — locked.
    expect(
      isBothConsistent(direction, [
        attr("direction", null, "forward"),
        attr("direction", "leader", "side"),
        attr("direction", "follower", "side"),
      ]),
    ).toBe(false);
  });
});

describe("role-write — splitSharedForRole", () => {
  it("re-tags a shared value as the OTHER role so this role's edit can't leak", () => {
    const shared = attr("rise", null, "commence");
    const next = splitSharedForRole([shared], "rise", 1, "leader");
    expect(next).toHaveLength(1);
    expect(next[0]?.role).toBe("follower");
    expect(next[0]?.value).toBe("commence");
  });

  it("only touches the given kind + count; other attributes pass through", () => {
    const attrs = [
      attr("rise", null, "commence", 1),
      attr("rise", null, "up", 2),
      attr("sway", null, "to_L", 1),
      attr("rise", "leader", "lowering", 1),
    ];
    const next = splitSharedForRole(attrs, "rise", 1, "follower");
    expect(next.find((a) => a.kind === "rise" && a.count === 1 && a.role === "leader")?.value).toBe(
      "commence",
    );
    expect(next.find((a) => a.kind === "rise" && a.count === 2)?.role).toBeNull();
    expect(next.find((a) => a.kind === "sway")?.role).toBeNull();
    // The pre-existing leader-tagged value is untouched.
    expect(next.filter((a) => a.kind === "rise" && a.count === 1)).toHaveLength(2);
  });

  it("the other role's visible view is unchanged by the split", () => {
    const attrs = [attr("direction", null, "forward")];
    const next = splitSharedForRole(attrs, "direction", 1, "leader");
    const followerView = next.filter(
      (a) => a.deletedAt == null && (a.role == null || a.role === "follower"),
    );
    expect(followerView.map((a) => a.value)).toEqual(["forward"]);
  });

  it("keeps ids deterministic and unique per (kind,count,value,scope)", () => {
    const attrs = [attr("rise", null, "commence")];
    const next = splitSharedForRole(attrs, "rise", 1, "leader");
    expect(next[0]?.id).toBe("rise-1-commence-follower");
  });

  it("tombstoned shared values are not resurrected", () => {
    const dead = { ...attr("rise", null, "commence"), deletedAt: 5 };
    const next = splitSharedForRole([dead], "rise", 1, "leader");
    expect(next).toEqual([dead]);
  });
});
