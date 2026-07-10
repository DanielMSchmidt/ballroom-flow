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
    // Footwork is a CLOSED PICKLIST in the editor (freeTextInput:false) over the
    // common contacts + named actions first, then the compound rolls the catalog
    // carries. (The schema stays lenient — freeText — for the syllabus scaffold.)
    expect(ATTRIBUTE_REGISTRY.footwork.freeTextInput).toBe(false);
    expect(ATTRIBUTE_REGISTRY.footwork.values).toEqual([
      "HT",
      "TH",
      "T",
      "H",
      "B",
      "WF",
      "BF",
      "IE",
      "flat",
      "heel turn",
      "heel pull",
      "H flat",
      "HB",
      "BT",
      "TB",
      "THB",
      "BHB",
      "HBH",
      "I/E of B",
      "I/E of BH",
      "O/E of T, BH",
      "BH",
      "HTH",
      "THT",
      "T/H/T",
      "H/T",
      "T/H",
      "T/TH",
      "TH/T",
    ]);
    expect(ATTRIBUTE_REGISTRY.direction.values).toEqual(
      expect.arrayContaining(["forward", "back", "side", "close"]),
    );
    expect(ATTRIBUTE_REGISTRY.rise.values).toEqual(expect.arrayContaining(["NFR"]));
    expect(ATTRIBUTE_REGISTRY.turn.values).toEqual(expect.arrayContaining(["eighth_L", "half_R"]));
    // Turn amounts extend past a half to a full turn (spin/twist/chase turns).
    expect(ATTRIBUTE_REGISTRY.turn.values).toEqual(
      expect.arrayContaining(["five_eighth_R", "three_quarter_R", "seven_eighth_R", "full_R"]),
    );
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

  it("normalizes the legacy diag_* spellings to the ISTD split diagonals on read", async () => {
    // Intent: forward-compatible alias normalization (Q-D4, ⟳2026-07-10). The
    // oldest split spelling (diag_forward/diag_back) maps onto the ISTD split
    // values the enum now carries; legacy docs read through without a migration.
    const { normalizeValue } = await importDomain();
    expect(normalizeValue("direction", "diag_forward")).toBe("diagonal_forward");
    expect(normalizeValue("direction", "diag_back")).toBe("diagonal_back");
  });

  it("models CBMP as a position (not a body action) and drops CBP entirely", async () => {
    // Intent: "CBMP is a position; remove CBP." CBMP lives under `position`;
    // `bodyActions` keeps only CBM; CBP is no longer recognized anywhere (read is
    // lenient, so it passes through unchanged rather than aliasing to CBMP).
    const { ATTRIBUTE_REGISTRY, normalizeValue } = await importDomain();
    expect(ATTRIBUTE_REGISTRY.position.values).toContain("CBMP");
    // bodyActions carries CBM + side_leading; CBMP/CBP never live here.
    expect(ATTRIBUTE_REGISTRY.bodyActions.values).toContain("CBM");
    expect(ATTRIBUTE_REGISTRY.bodyActions.values).not.toContain("CBMP");
    expect(normalizeValue("bodyActions", "CBP")).toBe("CBP"); // alias removed
  });

  it("models direction as the ISTD directional set plus crossing/legacy values (⟳2026-07-10)", async () => {
    // PLAN §3.8: direction is the step's relative TRANSLATION — the ISTD set
    // (forward/back/side/diagonal_forward/diagonal_back/close) plus the own-foot
    // crossing values in_front/behind (lock steps — NOT CBMP, which stays in
    // position/bodyActions), in_place, and the legacy UNSPLIT `diagonal` kept for
    // charts whose forward/back sense hasn't been re-verified (report §D). The
    // legacy diag_forward/diag_back spellings are aliases, not enum members.
    const { ATTRIBUTE_REGISTRY } = await importDomain();
    expect(ATTRIBUTE_REGISTRY.direction.values).toEqual([
      "forward",
      "back",
      "side",
      "diagonal_forward",
      "diagonal_back",
      "close",
      "behind",
      "in_front",
      "diagonal",
      "in_place",
    ]);
    expect(ATTRIBUTE_REGISTRY.direction.values).not.toContain("diag_forward");
    expect(ATTRIBUTE_REGISTRY.direction.values).not.toContain("diag_back");
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

  it("ships all eight standard kinds, every one builtin — footPosition + rotation removed (⟳2026-07-10)", async () => {
    // Intent: the standard tier is complete and flagged builtin (so the merge
    // and the creation UI can distinguish standard from user-defined kinds).
    // The ballet-derived footPosition kind is GONE (zero charted uses; `direction`
    // models the moving foot's placement), and the WDSF free-text `rotation`
    // column is GONE too (owner decision 2026-07-10: `turn` is the canonical
    // rotation — D33; the prose transcription stays in the seed for provenance
    // but is not modelled). The step model is direction + turn (PLAN §3/§3.8).
    const { ATTRIBUTE_REGISTRY } = await importDomain();
    for (const k of [
      "direction",
      "footwork",
      "rise",
      "position",
      "bodyActions",
      "sway",
      "turn",
      "head",
    ]) {
      expect(ATTRIBUTE_REGISTRY[k]).toBeDefined();
      expect(ATTRIBUTE_REGISTRY[k]?.builtin).toBe(true);
    }
    expect(ATTRIBUTE_REGISTRY.footPosition).toBeUndefined();
    expect(ATTRIBUTE_REGISTRY.rotation).toBeUndefined();
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
    expect(normalizeValue("footwork", "HT")).toBe("HT"); // canonical, not an alias
    expect(normalizeValue("footwork", "diag_forward")).toBe("diag_forward"); // alias scoped to direction only
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

describe("T5 RegistryKind is data-driven (description / valueDefs / roleAware / required)", () => {
  it("ships a one-line description + per-value definitions for every builtin", async () => {
    // Intent: the info-sheet prose is registry-derived, so every builtin must
    // carry a `description` and `valueDefs` covering its values.
    const { ATTRIBUTE_REGISTRY } = await importDomain();
    for (const k of Object.values(ATTRIBUTE_REGISTRY)) {
      expect(typeof k.description).toBe("string");
      expect(k.description?.length ?? 0).toBeGreaterThan(0);
      expect(k.valueDefs).toBeDefined();
      // Every enumerated value has a definition (info-sheet glossary coverage).
      for (const v of k.values ?? []) {
        expect(k.valueDefs?.[v], `${k.kind}.${v} missing a definition`).toBeTruthy();
      }
    }
  });

  it("marks direction as the required slot (the notate grid's Step* column)", async () => {
    // The EDIT grid renders "Step*" on the merged Step column whose driving kind
    // is `direction` (FigureTimeline `col.isStep`), so direction is `required`.
    const { ATTRIBUTE_REGISTRY } = await importDomain();
    expect(ATTRIBUTE_REGISTRY.direction.required).toBe(true);
    // The technique kinds are NOT required.
    expect(ATTRIBUTE_REGISTRY.rise.required ?? false).toBe(false);
    expect(ATTRIBUTE_REGISTRY.turn.required ?? false).toBe(false);
  });

  it("flags the role-mirroring kinds roleAware and leaves shared kinds off", async () => {
    // research/domain.md: the follower dances a different chart — direction
    // mirrors, footwork differs, sway/turn mirror; the hold (position) + rise are
    // shared by the couple.
    const { ATTRIBUTE_REGISTRY } = await importDomain();
    for (const k of ["direction", "footwork", "sway", "turn", "bodyActions"]) {
      expect(ATTRIBUTE_REGISTRY[k]?.roleAware, `${k} should be roleAware`).toBe(true);
    }
    expect(ATTRIBUTE_REGISTRY.position.roleAware ?? false).toBe(false);
    expect(ATTRIBUTE_REGISTRY.rise.roleAware ?? false).toBe(false);
  });

  it("preserves the new fields on a merged custom kind", async () => {
    // mergeRegistry assigns the whole descriptor, so a custom kind carrying
    // description/valueDefs/roleAware/required keeps them downstream.
    const { ATTRIBUTE_REGISTRY, mergeRegistry } = await importDomain();
    const merged = mergeRegistry(ATTRIBUTE_REGISTRY, [
      {
        kind: "energy",
        label: "Energy",
        color: "#123456",
        cardinality: "single",
        valueType: "enum",
        values: ["low", "high"],
        description: "How much drive the step carries.",
        valueDefs: { low: "Low — relaxed", high: "High — driving" },
        roleAware: true,
        required: false,
        builtin: false,
      },
    ]);
    expect(merged.energy?.description).toBe("How much drive the step carries.");
    expect(merged.energy?.valueDefs?.high).toBe("High — driving");
    expect(merged.energy?.roleAware).toBe(true);
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
