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

describe.skip("US-003 ATTRIBUTE_REGISTRY + merge", () => {
  it("ships the standard kinds with their footwork/rise/turn values", async () => {
    // Intent: standard vocabulary present (step footwork, rise incl. NFR, turn).
    // Arrange: import the registry. Act: read each standard kind's values.
    // Assert: step has HT/T/TH/heel_pull/H; rise has NFR; turn has eighth_L…half_R.
    // Covers AC-1 (standard kinds + values).
    const { ATTRIBUTE_REGISTRY } = await importDomain();
    expect(ATTRIBUTE_REGISTRY.step.values).toEqual(
      expect.arrayContaining(["HT", "T", "TH", "heel_pull", "H"]),
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
});
