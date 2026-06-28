import { describe, expect, it } from "vitest";
import { importDomain } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-003 — ATTRIBUTE_REGISTRY + merge [M1, system/developer]
// PLAN §3, §10.2 invariant: "registry/Zod — NFR/H/⅛; Tango omits rise;
// position vs body-action; CBP→CBMP; unknown passthrough-on-read; user-defined
// kind merges". One vocabulary read by editor, lanes, chips, Zod.
//
// Product `ATTRIBUTE_REGISTRY` + `mergeRegistry` (vocabulary.ts, M1 §9 1.3) do
// not exist yet → dynamic import, skipped. RED→GREEN: implement the registry +
// merge so each assertion passes.
// ─────────────────────────────────────────────────────────────────────────

describe("US-003 ATTRIBUTE_REGISTRY + merge", () => {
  it("ships the standard kinds with their direction/footwork/rise/turn values", async () => {
    // Intent: standard vocabulary present (direction headline, footwork foot-part,
    // rise incl. NFR, turn). The old `step` kind was renamed to `footwork`
    // (2026-06-28 parity spec).
    // Arrange: import the registry. Act: read each standard kind's values.
    // Covers AC-1 (standard kinds + values).
    const { ATTRIBUTE_REGISTRY } = await importDomain();
    expect(ATTRIBUTE_REGISTRY.footwork.values).toEqual(
      expect.arrayContaining(["ball", "heel", "toe", "tap"]),
    );
    expect(ATTRIBUTE_REGISTRY.direction.values).toEqual(
      expect.arrayContaining(["forward", "back", "side", "close"]),
    );
    expect(ATTRIBUTE_REGISTRY.rise.values).toEqual(expect.arrayContaining(["NFR"]));
    expect(ATTRIBUTE_REGISTRY.turn.values).toEqual(expect.arrayContaining(["eighth_L", "half_R"]));
  });

  it("omits rise for Tango via appliesToDances", async () => {
    // Intent: Tango has no rise; the editor's rise section must hide for Tango.
    // Arrange: import registry. Act: read rise.appliesToDances.
    // Assert: it excludes "tango" (or a helper reports rise inapplicable to tango).
    // Covers AC-2 (rise omitted for Tango) — the §10.2 "Tango omits rise" invariant.
    const { ATTRIBUTE_REGISTRY } = await importDomain();
    expect(ATTRIBUTE_REGISTRY.rise.appliesToDances ?? []).not.toContain("tango");
  });

  it("models position as single and bodyActions as multi cardinality", async () => {
    // Intent: single-select vs multi-select drives the attribute editor (US-029).
    // Arrange: import registry. Act: read cardinalities.
    // Assert: position single; bodyActions multi.
    // Covers AC-3 (single vs multi cardinality).
    const { ATTRIBUTE_REGISTRY } = await importDomain();
    expect(ATTRIBUTE_REGISTRY.position.cardinality).toBe("single");
    expect(ATTRIBUTE_REGISTRY.bodyActions.cardinality).toBe("multi");
  });

  it("normalizes the CBP alias to CBMP on read", async () => {
    // Intent: forward-compatible alias normalization (Q-D4).
    // Arrange: import the normalize helper. Act: normalize "CBP" for bodyActions.
    // Assert: result is "CBMP".
    // Covers AC-4 (CBP→CBMP) — §10.2 "CBP→CBMP" invariant.
    const { normalizeValue } = await importDomain();
    expect(normalizeValue("bodyActions", "CBP")).toBe("CBMP");
  });

  it("merges a user-defined kind so it is indistinguishable downstream", async () => {
    // Intent: a custom kind merges into the registry (US-043 depends on this).
    // Arrange: import registry + merge. Act: merge a {kind,label,color,
    //   cardinality,valueType,values} user kind.
    // Assert: the merged registry exposes it with color/cardinality/valueType honored.
    // Covers AC-5 (user-defined kind merges) — §10.2 "user-defined kind merges".
    const { ATTRIBUTE_REGISTRY, mergeRegistry } = await importDomain();
    const merged = mergeRegistry(ATTRIBUTE_REGISTRY, [
      {
        kind: "energy",
        label: "Energy",
        color: "#123456",
        cardinality: "single",
        valueType: "enum",
        values: ["low", "high"],
        builtin: false,
      },
    ]);
    expect(merged.energy?.color).toBe("#123456");
    expect(merged.energy?.cardinality).toBe("single");
    expect(merged.energy?.values).toEqual(["low", "high"]);
  });

  // ── Extra edge cases (in the spirit of US-003, beyond the listed ACs) ──

  it("ships all seven standard kinds, every one builtin", async () => {
    // Intent: the standard tier is complete and flagged builtin (so the merge
    // and the creation UI can distinguish standard from user-defined kinds).
    const { ATTRIBUTE_REGISTRY } = await importDomain();
    for (const k of ["direction", "footwork", "rise", "position", "bodyActions", "sway", "turn"]) {
      expect(ATTRIBUTE_REGISTRY[k]).toBeDefined();
      expect(ATTRIBUTE_REGISTRY[k]?.builtin).toBe(true);
    }
  });

  it("applies rise to every Standard dance except Tango", async () => {
    // Intent: AC-2 stated positively — rise applies to the 4 swing dances.
    const { ATTRIBUTE_REGISTRY } = await importDomain();
    expect((ATTRIBUTE_REGISTRY.rise.appliesToDances ?? []).sort()).toEqual(
      ["foxtrot", "quickstep", "viennese_waltz", "waltz"].sort(),
    );
  });

  it("passes unknown values and non-aliased values through normalizeValue", async () => {
    // Intent: forward-compatible reads — only true aliases are rewritten.
    const { normalizeValue } = await importDomain();
    expect(normalizeValue("bodyActions", "CBM")).toBe("CBM"); // known, not an alias
    expect(normalizeValue("bodyActions", "future_value")).toBe("future_value"); // unknown
    expect(normalizeValue("step", "CBP")).toBe("CBP"); // alias scoped to bodyActions only
  });

  it("merge does not mutate the base registry", async () => {
    // Intent: mergeRegistry is pure — adding a kind must not leak into the shared
    // ATTRIBUTE_REGISTRY singleton (it's read everywhere).
    const { ATTRIBUTE_REGISTRY, mergeRegistry } = await importDomain();
    const before = Object.keys(ATTRIBUTE_REGISTRY).length;
    mergeRegistry(ATTRIBUTE_REGISTRY, [
      {
        kind: "tempo",
        label: "Tempo",
        color: "#000000",
        cardinality: "single",
        valueType: "enum",
        values: ["slow", "fast"],
        builtin: false,
      },
    ]);
    expect(Object.keys(ATTRIBUTE_REGISTRY).length).toBe(before);
    expect(ATTRIBUTE_REGISTRY.tempo).toBeUndefined();
  });

  it("reserves builtin slugs: a custom kind cannot override a standard kind (task #17)", async () => {
    // Intent: a user-defined kind whose slug collides with a builtin is IGNORED —
    // the builtin wins. Otherwise a custom kind keyed "rise" could drop
    // appliesToDances and re-enable rise for Tango (the §10.2 invariant US-003
    // protects). Guard lives in mergeRegistry so the registry is safe by
    // construction, not only at the US-043 creation UI.
    const { ATTRIBUTE_REGISTRY, mergeRegistry } = await importDomain();
    const merged = mergeRegistry(ATTRIBUTE_REGISTRY, [
      {
        kind: "rise", // collides with the builtin
        label: "Hacked Rise",
        color: "#000000",
        cardinality: "multi",
        valueType: "enum",
        values: ["anything"],
        builtin: false,
        // note: NO appliesToDances — would re-enable rise for Tango if it won
      },
    ]);
    // The builtin survives unchanged: still single, still omits Tango.
    expect(merged.rise.label).toBe(ATTRIBUTE_REGISTRY.rise.label);
    expect(merged.rise.cardinality).toBe("single");
    expect(merged.rise.appliesToDances ?? []).not.toContain("tango");
    expect(merged.rise.builtin).toBe(true);
  });

  it("still merges a NON-colliding custom kind alongside the reserved builtins", async () => {
    // Intent: the guard only blocks builtin collisions — genuine custom kinds
    // still merge.
    const { ATTRIBUTE_REGISTRY, mergeRegistry } = await importDomain();
    const merged = mergeRegistry(ATTRIBUTE_REGISTRY, [
      {
        kind: "energy",
        label: "Energy",
        color: "#123456",
        cardinality: "single",
        valueType: "enum",
        values: ["low", "high"],
        builtin: false,
      },
    ]);
    expect(merged.energy?.label).toBe("Energy");
    expect(merged.rise.builtin).toBe(true); // builtins intact
  });
});

describe("US-043 custom kind slug helpers", () => {
  it("slugifies a label to a safe kind id", async () => {
    const { slugifyKind } = await import("./vocabulary");
    expect(slugifyKind("Energy Level!")).toBe("energy_level");
    expect(slugifyKind("  Foot  Pressure ")).toBe("foot_pressure");
  });
  it("flags builtin slugs as reserved", async () => {
    const { isReservedKind } = await import("./vocabulary");
    expect(isReservedKind("footwork")).toBe(true);
    expect(isReservedKind("direction")).toBe(true);
    expect(isReservedKind("rise")).toBe(true);
    expect(isReservedKind("energy")).toBe(false);
  });
  it("mergeRegistry ignores a custom kind colliding with a builtin", async () => {
    const { mergeRegistry, ATTRIBUTE_REGISTRY } = await import("./vocabulary");
    const merged = mergeRegistry(ATTRIBUTE_REGISTRY, [
      {
        kind: "rise",
        label: "Hacked",
        color: "#000",
        cardinality: "single",
        valueType: "enum",
        values: [],
        builtin: false,
      },
    ]);
    expect(merged.rise.label).toBe("Rise & Fall"); // builtin wins
  });
});
