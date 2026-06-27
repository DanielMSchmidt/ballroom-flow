import type { Attribute } from "@ballroom/domain";
import { resolve } from "@ballroom/domain";
import { describe, expect, it } from "vitest";
import { overlayFromAttributes } from "./overlay-diff";

const base: Attribute[] = [
  { id: "b1", kind: "step", count: 1, role: null, value: "HT" },
  { id: "b2", kind: "sway", count: 2, role: null, value: "to_L" },
];

function baseFigure() {
  return {
    id: "base",
    scope: "global" as const,
    ownerId: "app",
    figureType: "feather",
    dance: "foxtrot" as const,
    name: "Feather",
    source: "library" as const,
    attributes: base,
    schemaVersion: 1,
    deletedAt: null,
  };
}

describe("overlayFromAttributes", () => {
  it("overrides a changed base value", () => {
    const next: Attribute[] = [
      { id: "b1", kind: "step", count: 1, role: null, value: "T" }, // changed HT→T
      { id: "b2", kind: "sway", count: 2, role: null, value: "to_L" },
    ];
    const ov = overlayFromAttributes(base, next);
    expect(ov.overrides).toEqual({ b1: "T" });
    expect(ov.tombstones).toEqual([]);
    expect(ov.additions).toEqual([]);
    // Round-trips through resolve back to next.
    expect(resolve(baseFigure(), ov).attributes).toEqual(next);
  });

  it("tombstones a removed base attribute and appends a brand-new one", () => {
    const next: Attribute[] = [
      { id: "b1", kind: "step", count: 1, role: null, value: "HT" }, // unchanged → inherited
      { id: "n1", kind: "rise", count: 3, role: null, value: "rise" }, // new → addition
    ];
    const ov = overlayFromAttributes(base, next);
    expect(ov.overrides).toEqual({});
    expect(ov.tombstones).toEqual(["b2"]);
    expect(ov.additions).toEqual([{ id: "n1", kind: "rise", count: 3, role: null, value: "rise" }]);
  });

  it("ignores soft-deleted next attributes (treated as absent)", () => {
    const next: Attribute[] = [
      { id: "b1", kind: "step", count: 1, role: null, value: "HT" },
      { id: "b2", kind: "sway", count: 2, role: null, value: "to_L", deletedAt: 123 },
    ];
    const ov = overlayFromAttributes(base, next);
    expect(ov.tombstones).toEqual(["b2"]);
  });
});
