import { describe, expect, it } from "vitest";
import { migrate } from "./migrations";
import { ATTRIBUTE_REGISTRY, normalizeValue } from "./vocabulary";

// ─────────────────────────────────────────────────────────────────────────
// Notation editor design-parity (2026-06-28 spec).
//
// Steps alternate feet automatically (foot is never stored). A step's two real
// dimensions are `direction` (the headline) and `footwork` (the foot part). The
// old `step` kind held foot-part pressure tokens (HT/T/TH/…), so it is renamed
// to `footwork` with a readable value set; a new `direction` kind is the
// headline. Legacy `kind:"step"` attributes are retagged → `footwork` by the v2
// migration; legacy single tokens normalize on read (H→heel, T→toe).
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
    expect(footwork.values).toEqual(
      expect.arrayContaining(["ball", "ball_flat", "flat", "heel", "heel_ball", "toe", "tap"]),
    );
  });

  it("adds a `direction` kind as the step headline (single, closed enum)", () => {
    const direction = ATTRIBUTE_REGISTRY.direction;
    expect(direction).toBeDefined();
    expect(direction.label).toBe("Direction");
    expect(direction.cardinality).toBe("single");
    expect(direction.builtin).toBe(true);
    // A closed enum (NOT free-text): direction is a controlled vocabulary.
    expect(direction.freeText ?? false).toBe(false);
    expect(direction.values).toEqual(
      expect.arrayContaining([
        "forward",
        "back",
        "side",
        "close",
        "diag_forward",
        "diag_back",
        "in_place",
      ]),
    );
  });

  it("normalizes legacy single footwork tokens on read (H→heel, T→toe)", () => {
    expect(normalizeValue("footwork", "H")).toBe("heel");
    expect(normalizeValue("footwork", "T")).toBe("toe");
    // A readable value passes through unchanged; an unknown one too.
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
    expect(migrated.schemaVersion).toBe(3); // v1→v2 (footwork) →v3 (sortKey, no-op for a figure)
    // value preserved verbatim (lossless); other kinds untouched
    expect(migrated.attributes[0]).toMatchObject({ kind: "footwork", value: "HT" });
    expect(migrated.attributes[1]).toMatchObject({ kind: "rise" });
  });

  it("retags step attributes inside a variant overlay's additions", () => {
    const variant = {
      schemaVersion: 1,
      figureType: "natural-turn",
      dance: "waltz",
      attributes: [],
      overlay: {
        overrides: {},
        tombstones: [],
        additions: [{ id: "v1", kind: "step", count: 2, value: "T" }],
      },
    };
    const migrated = migrate(variant) as typeof variant;
    expect(migrated.overlay.additions[0]).toMatchObject({ kind: "footwork", value: "T" });
  });

  it("leaves a routine doc's content untouched apart from the version bump + sortKeys", () => {
    // The footwork retag (v1→v2) ignores routine docs (no attributes); the v2→v3
    // step adds a `sortKey` to each section/placement in array order (#63) but
    // preserves ids, names, and order.
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
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.sections.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(migrated.sections.map((s) => s.name)).toEqual(["Intro", "Body"]);
    // sortKeys added in array order (ascending).
    const keys = migrated.sections.map((s) => s.sortKey);
    expect(keys.every((k) => typeof k === "string")).toBe(true);
    expect(String(keys[0]) < String(keys[1])).toBe(true);
  });

  it("never injects an `attributes`/`overlay` key on a doc that lacks one", () => {
    // Automerge cannot store `undefined`; a migration that spreads back
    // `attributes: undefined` corrupts routine docs (and broke template forks).
    const routine = { schemaVersion: 1, sections: [] };
    const migrated = migrate(routine);
    expect("attributes" in migrated).toBe(false);
    expect("overlay" in migrated).toBe(false);
  });
});
