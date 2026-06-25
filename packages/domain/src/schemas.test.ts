import { describe, expect, it } from "vitest";
import { importDomain } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-012 — Zod schemas (lenient read / strict write) [M1, system/developer]
// PLAN §3, D7, §10.2 invariant: "unknown passthrough-on-read vs reject-on-write;
// CBP→CBMP; timing range per meter". Schemas are derived from the merged registry.
//
// Product `schemas.ts` (M1 §9 1.10) doesn't exist yet → dynamic import, skipped.
// RED→GREEN: export `zAttributeRead`/`zAttributeWrite` (or read/write parsers).
// ─────────────────────────────────────────────────────────────────────────

describe.skip("US-012 Zod schemas (lenient read / strict write)", () => {
  it("passes an unknown attribute value on READ (forward compatible)", async () => {
    // Intent: a future/unknown value survives a read (no data loss).
    // Arrange: an attribute with kind:"step", value:"FUTURE_FOOTWORK".
    // Act: parse with the lenient READ schema.
    // Assert: parse succeeds and preserves the unknown value.
    // Covers US-012 AC-2 first half (unknown passes on read) — §10.2 "passthrough-on-read".
    const { parseAttributeRead } = await importDomain();
    const parsed = parseAttributeRead({
      id: "a1",
      kind: "step",
      count: 1,
      value: "FUTURE_FOOTWORK",
    });
    expect(parsed.value).toBe("FUTURE_FOOTWORK");
  });

  it("rejects an unknown value written to a known kind on WRITE", async () => {
    // Intent: writes are validated against the known vocabulary (strict).
    // Arrange: same unknown-value attribute. Act: parse with the strict WRITE schema.
    // Assert: it throws / returns a failure.
    // Covers US-012 AC-2 second half (reject on write) — §10.2 "reject-on-write".
    const { parseAttributeWrite } = await importDomain();
    expect(() =>
      parseAttributeWrite({ id: "a1", kind: "step", count: 1, value: "NOT_A_FOOTWORK" }),
    ).toThrow();
  });

  it("rejects a timing value outside the meter's valid range on write", async () => {
    // Intent: a count beyond the dance phrase is invalid on write.
    // Arrange: a Waltz figure context (phrase 1–6); an attribute at count 7.5.
    // Act: parse with the write schema bound to the dance meter.
    // Assert: throws (out of range).
    // Covers US-012 AC-3 (timing range per meter) — §10.2 "timing range per meter".
    const { parseAttributeWrite } = await importDomain();
    expect(() =>
      parseAttributeWrite({ id: "a1", kind: "step", count: 7.5, value: "HT" }, { dance: "waltz" }),
    ).toThrow();
  });

  it("normalizes CBP→CBMP on read", async () => {
    // Intent: alias normalization happens at the schema boundary too.
    // Arrange: a bodyActions attribute with value "CBP".
    // Act: parse with the read schema. Assert: normalized to "CBMP".
    // Covers US-012 AC-4 (CBP→CBMP normalizes on read).
    const { parseAttributeRead } = await importDomain();
    const parsed = parseAttributeRead({ id: "a1", kind: "bodyActions", count: 1, value: "CBP" });
    expect(parsed.value).toBe("CBMP");
  });
});
