import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, migrate } from "./migrations";
import { ATTRIBUTE_REGISTRY, normalizeValue } from "./vocabulary";

// ─────────────────────────────────────────────────────────────────────────
// Notation editor design-parity (2026-06-28 spec).
//
// Steps alternate feet automatically (foot is never stored). A step's two real
// dimensions are `direction` (the headline) and `footwork` (the foot part). The
// old `step` kind held foot-part pressure tokens (HT/T/TH/…), so it is renamed
// to `footwork` whose pickable set is the design's compound ISTD codes
// (HT/T/TH/H/heel pull); a new `direction` kind is the headline. Legacy
// `kind:"step"` attributes are retagged → `footwork` by the v2 migration; H and
// T are now canonical picker values (no longer rewritten on read).
// ─────────────────────────────────────────────────────────────────────────

describe("vocabulary — footwork + direction kinds", () => {
  it("renames step → footwork: readable, single-select, free-text", () => {
    // The old `step` slug is gone; `footwork` is its replacement.
    expect(ATTRIBUTE_REGISTRY.step).toBeUndefined();
    const footwork = ATTRIBUTE_REGISTRY.footwork;
    expect(footwork).toBeDefined();
    expect(footwork.label).toBe("Footwork");
    expect(footwork.cardinality).toBe("single");
    expect(footwork.freeText).toBe(true);
    expect(footwork.builtin).toBe(true);
    // The pickable set is the design's compound ISTD codes; freeText still
    // accepts legacy anatomical values (ball/heel/…) on write + display.
    expect(footwork.values).toEqual(["HT", "T", "TH", "H", "heel pull"]);
  });

  it("adds a `direction` kind as the step headline (single, closed enum)", () => {
    const direction = ATTRIBUTE_REGISTRY.direction;
    expect(direction).toBeDefined();
    expect(direction.label).toBe("Direction");
    expect(direction.cardinality).toBe("single");
    expect(direction.builtin).toBe(true);
    // A closed enum (NOT free-text): direction is a controlled vocabulary.
    expect(direction.freeText ?? false).toBe(false);
    // One `diagonal` (the split diag_forward/diag_back collapsed) + `behind`.
    expect(direction.values).toEqual(
      expect.arrayContaining([
        "forward",
        "back",
        "side",
        "behind",
        "close",
        "diagonal",
        "in_place",
      ]),
    );
    expect(direction.values).not.toContain("diag_forward");
    expect(direction.values).not.toContain("diag_back");
  });

  it("normalizes the split diagonal to a single `diagonal` on read", () => {
    // The split diag_forward/diag_back collapsed into one `diagonal` value.
    expect(normalizeValue("direction", "diag_forward")).toBe("diagonal");
    expect(normalizeValue("direction", "diag_back")).toBe("diagonal");
    // A canonical value passes through unchanged; an unknown one too.
    expect(normalizeValue("direction", "forward")).toBe("forward");
    expect(normalizeValue("direction", "behind")).toBe("behind");
  });

  it("leaves H and T unrewritten — they are canonical footwork picker values now", () => {
    // The old H→heel / T→toe aliases are removed; H/T are pickable codes.
    expect(normalizeValue("footwork", "H")).toBe("H");
    expect(normalizeValue("footwork", "T")).toBe("T");
    // Legacy anatomical + unknown values still pass through (freeText).
    expect(normalizeValue("footwork", "ball")).toBe("ball");
    expect(normalizeValue("footwork", "brush")).toBe("brush");
  });
});

describe("migration v2 — step → footwork retag", () => {
  it('retags a figure doc\'s `kind:"step"` attributes to `footwork`, preserving values', () => {
    const figure = {
      schemaVersion: 1,
      figureType: "natural-turn",
      dance: "waltz",
      attributes: [
        { id: "a1", kind: "step", count: 1, value: "HT" },
        { id: "a2", kind: "rise", count: 1, value: "commence" },
      ],
    };
    const migrated = migrate(figure) as typeof figure;
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // value preserved verbatim (lossless); other kinds untouched
    expect(migrated.attributes[0]).toMatchObject({ kind: "footwork", value: "HT" });
    expect(migrated.attributes[1]).toMatchObject({ kind: "rise" });
  });

  it("leaves a routine doc's content untouched apart from the version bump + sortKeys", () => {
    // The footwork retag (v1→v2) and overlay strip (v2→v3) ignore routine docs
    // (no attributes / no overlay); the v3→v4 step adds a `sortKey` to each
    // section/placement in array order (#63) but preserves ids, names, and order.
    const routine = {
      schemaVersion: 1,
      sections: [
        { id: "s1", name: "Intro", placements: [] },
        { id: "s2", name: "Body", placements: [] },
      ],
    };
    const migrated = migrate(routine) as unknown as {
      schemaVersion: number;
      sections: Array<{ id: string; name: string; sortKey?: string }>;
    };
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.sections.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(migrated.sections.map((s) => s.name)).toEqual(["Intro", "Body"]);
    // sortKeys added in array order (ascending).
    const keys = migrated.sections.map((s) => s.sortKey);
    expect(keys.every((k) => typeof k === "string")).toBe(true);
    expect(String(keys[0]) < String(keys[1])).toBe(true);
  });

  it("never injects an `attributes` key on a doc that lacks one", () => {
    // Automerge cannot store `undefined`; a migration that spreads back
    // `attributes: undefined` corrupts routine docs (and broke template forks).
    const routine = { schemaVersion: 1, sections: [] };
    const migrated = migrate(routine);
    expect("attributes" in migrated).toBe(false);
    // overlay is stripped by v2→v3, but a doc that never had it must not gain it.
    expect("overlay" in migrated).toBe(false);
  });
});
