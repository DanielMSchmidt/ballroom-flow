import { describe, expect, it } from "vitest";
import {
  FEATHER_FOXTROT,
  importDomain,
  makeAttribute,
  makeOverlay,
  STUDENT_FEATHER_VARIANT,
} from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-006 — Overlay resolution resolve(base, overlay) [M1, system/developer]
// PLAN §2.2, §5.2, §10.2 invariant: "overlay resolution (inherit/override/
// tombstone/addition/rename; base-addition flow-up)". A variant inherits the
// LIVE base and stores only its divergences; the function is pure.
//
// Product `overlay.ts` `resolve` (M1 §9 1.6) doesn't exist yet → dynamic import,
// skipped. RED→GREEN: implement `resolve(base, overlay)`.
// ─────────────────────────────────────────────────────────────────────────

describe("US-006 Overlay resolution resolve(base, overlay)", () => {
  it("applies tombstones + overrides + additions and the rename", async () => {
    // Intent: effective = base − tombstones, overrides applied, plus additions.
    // Arrange: the global Feather base + STUDENT_FEATHER_VARIANT's overlay
    //   (override a_ff_2→"TH", tombstone a_ff_3, add a sway, rename "My Feather").
    // Act: resolve(base, overlay).
    // Assert: a_ff_3 gone; a_ff_2 value "TH"; the sway addition present; name renamed.
    // Covers AC-1 (− tombstones + overrides + additions) + AC-2 (rename).
    const { resolve } = await importDomain();
    const eff = resolve(FEATHER_FOXTROT, STUDENT_FEATHER_VARIANT.overlay ?? makeOverlay());
    const byId = Object.fromEntries(eff.attributes.map((a) => [a.id, a]));
    expect(byId.a_ff_3).toBeUndefined();
    expect(byId.a_ff_2?.value).toBe("TH");
    expect(eff.attributes.some((a) => a.kind === "sway")).toBe(true);
    expect(eff.name).toBe("My Feather");
  });

  it("flows a new base attribute up into the variant automatically", async () => {
    // Intent: base edits to NON-overridden attributes appear in the variant live.
    // Scenario: the app adds a count-4 step to the global base AFTER the variant exists.
    // Arrange: base with an extra a_ff_4 attribute; the same student overlay.
    // Act: resolve(updatedBase, overlay).
    // Assert: a_ff_4 is present in the resolved variant (it flowed up).
    // Covers AC-3 (base additions flow up) — the §10.2 "base-addition flow-up" invariant.
    const { resolve } = await importDomain();
    const updatedBase = {
      ...FEATHER_FOXTROT,
      attributes: [...FEATHER_FOXTROT.attributes, makeAttribute({ id: "a_ff_4", count: 4 })],
    };
    const eff = resolve(updatedBase, STUDENT_FEATHER_VARIANT.overlay ?? makeOverlay());
    expect(eff.attributes.some((a) => a.id === "a_ff_4")).toBe(true);
  });

  it("lets overrides win over the base and is pure (does not mutate base)", async () => {
    // Intent: override precedence + purity/determinism (AC-4).
    // Arrange: snapshot the base JSON; an overlay overriding a_ff_1.
    // Act: resolve twice with the same inputs.
    // Assert: overridden value wins; two calls are deeply equal; base unchanged.
    // Covers AC-4 (overrides win; pure/deterministic; no base mutation).
    const { resolve } = await importDomain();
    const before = JSON.stringify(FEATHER_FOXTROT);
    const overlay = makeOverlay({ overrides: { a_ff_1: "H" } });
    const first = resolve(FEATHER_FOXTROT, overlay);
    const second = resolve(FEATHER_FOXTROT, overlay);
    expect(first.attributes.find((a) => a.id === "a_ff_1")?.value).toBe("H");
    expect(first).toEqual(second);
    expect(JSON.stringify(FEATHER_FOXTROT)).toBe(before);
  });

  // ── Extra edge cases (in the spirit of US-006, beyond the listed ACs) ──

  it("returns the base attributes unchanged under an empty overlay", async () => {
    // Intent: an overlay with no divergences resolves to the base's attributes
    // (the inheritance baseline), with no rename.
    const { resolve } = await importDomain();
    const eff = resolve(FEATHER_FOXTROT, makeOverlay());
    expect(eff.attributes.map((a) => a.id)).toEqual(FEATHER_FOXTROT.attributes.map((a) => a.id));
    expect(eff.name).toBe(FEATHER_FOXTROT.name);
  });

  it("keeps a tombstoned attribute gone even if also overridden", async () => {
    // Intent: tombstone wins — an id both dropped and overridden is absent
    // (a tombstone removes the base attribute entirely; no override resurrects it).
    const { resolve } = await importDomain();
    const overlay = makeOverlay({ tombstones: ["a_ff_2"], overrides: { a_ff_2: "H" } });
    const eff = resolve(FEATHER_FOXTROT, overlay);
    expect(eff.attributes.some((a) => a.id === "a_ff_2")).toBe(false);
  });

  it("does not share attribute objects by reference with the base", async () => {
    // Intent: mutating the resolved result must never reach back into the base
    // (purity at the element grain, not just the top level).
    const { resolve } = await importDomain();
    const eff = resolve(FEATHER_FOXTROT, makeOverlay());
    const first = eff.attributes[0];
    expect(first).toBeDefined();
    expect(first).not.toBe(FEATHER_FOXTROT.attributes[0]);
  });
});
