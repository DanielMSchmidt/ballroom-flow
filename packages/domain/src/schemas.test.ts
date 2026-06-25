import { describe, expect, it } from "vitest";
import { z } from "zod";
import { importDomain } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-012 — Zod schemas (lenient read / strict write) [M1, system/developer]
// PLAN §3, D7, §10.2 invariant: "unknown passthrough-on-read vs reject-on-write;
// CBP→CBMP; timing range per meter". Schemas are derived from the merged registry.
//
// Product `schemas.ts` (M1 §9 1.10) doesn't exist yet → dynamic import, skipped.
// RED→GREEN: export `zAttributeRead`/`zAttributeWrite` (or read/write parsers).
// ─────────────────────────────────────────────────────────────────────────

describe("US-012 Zod schemas (lenient read / strict write)", () => {
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

  it("rejects an off-grid / below-1 timing value on write (valid range = on-grid + ≥1)", async () => {
    // Intent: a count that isn't a real sub-beat is invalid on write. "Valid
    // range" per §2.5/US-004 = on the 1/8-note grid AND ≥ 1 — NOT a phrase cap
    // (figures span multiple phrases; counts may exceed phraseBeats and wrap).
    // Arrange: an OFF-GRID fraction (3.3, not a multiple of 1/8) and a below-1 count.
    // Act/Assert: both throw.
    // Covers US-012 AC-3 (timing range per meter) — corrected to match merged US-004.
    const { parseAttributeWrite } = await importDomain();
    expect(() =>
      parseAttributeWrite({ id: "a1", kind: "step", count: 3.3, value: "HT" }, { dance: "waltz" }),
    ).toThrow(); // off-grid
    expect(() =>
      parseAttributeWrite({ id: "a1", kind: "step", count: 0.5, value: "HT" }, { dance: "waltz" }),
    ).toThrow(); // below 1
  });

  it("accepts a multi-phrase count on write (aligns with US-004 modulo-phrase)", async () => {
    // Intent: a count exceeding phraseBeats is VALID — figures span multiple
    // phrases (§2.5 "modulo the counted phrase"; countToPhrase wraps it). Pins
    // the reconciliation with merged US-004 (countToPhrase(7,"waltz")→phrase 2).
    const { parseAttributeWrite } = await importDomain();
    // Waltz phrase 6: count 7 (phrase 2 beat 1) and 7.5 (phrase 2 "&") are valid.
    expect(
      parseAttributeWrite({ id: "a1", kind: "step", count: 7, value: "HT" }, { dance: "waltz" })
        .count,
    ).toBe(7);
    expect(
      parseAttributeWrite({ id: "a2", kind: "step", count: 7.5, value: "HT" }, { dance: "waltz" })
        .count,
    ).toBe(7.5);
    // Foxtrot phrase 8: count 9 (bar 2 beat 1) is valid.
    expect(
      parseAttributeWrite({ id: "a3", kind: "step", count: 9, value: "HT" }, { dance: "foxtrot" })
        .count,
    ).toBe(9);
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

  // ── Extra edge cases (in the spirit of US-012, beyond the listed ACs) ──

  it("accepts a known registry value on write (the happy path)", async () => {
    // Intent: the strict write schema lets valid vocabulary through.
    const { parseAttributeWrite } = await importDomain();
    const ok = parseAttributeWrite({ id: "a1", kind: "step", count: 1, value: "HT" });
    expect(ok.value).toBe("HT");
  });

  it("accepts a count within the meter's phrase on write", async () => {
    // Intent: a count inside the dance phrase is valid (counterpart to the range test).
    const { parseAttributeWrite } = await importDomain();
    const ok = parseAttributeWrite(
      { id: "a1", kind: "step", count: 5.5, value: "HT" },
      { dance: "waltz" }, // phrase 1–6: 5.5 is in range
    );
    expect(ok.count).toBe(5.5);
  });

  it("normalizes CBP→CBMP on write, then accepts it (alias is a known value)", async () => {
    // Intent: the alias normalizes before the strict enum check, so writing the
    // alias of a known value succeeds (and is stored canonical).
    const { parseAttributeWrite } = await importDomain();
    const ok = parseAttributeWrite({ id: "a1", kind: "bodyActions", count: 1, value: "CBP" });
    expect(ok.value).toBe("CBMP");
  });

  it("does not enum-restrict an unknown (user-defined) kind on write", async () => {
    // Intent: a kind not in this registry copy (future custom kind) isn't value-
    // restricted here — its values are validated by its own registry entry (US-043).
    const { parseAttributeWrite } = await importDomain();
    const ok = parseAttributeWrite({ id: "a1", kind: "energy", count: 1, value: "high" });
    expect(ok.value).toBe("high");
  });

  it("raises every write failure as one ZodError with a stable code (uniform contract)", async () => {
    // Intent: structural, invalid-value, and out-of-range failures all surface as
    // a single ZodError so a caller catches one type and reads error.issues —
    // domain-rule issues carry params.code + the offending data (US-029/M2 format
    // their own message from these, not from regexing dev strings).
    const { parseAttributeWrite } = await importDomain();

    // (a) structural failure → ZodError (invalid_type)
    expect(() =>
      parseAttributeWrite({ id: "a1", kind: "step", count: "nope", value: "HT" }),
    ).toThrow(z.ZodError);

    // (b) invalid value → ZodError with params.code "unknown_value"
    try {
      parseAttributeWrite({ id: "a1", kind: "step", count: 1, value: "NOT_A_FOOTWORK" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(z.ZodError);
      const issue = (e as z.ZodError).issues[0] as { params?: { code?: string; kind?: string } };
      expect(issue.params?.code).toBe("unknown_value");
      expect(issue.params?.kind).toBe("step");
    }

    // (c) off-grid count → ZodError with params.code "count_off_grid"
    try {
      parseAttributeWrite({ id: "a1", kind: "step", count: 3.3, value: "HT" }, { dance: "waltz" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(z.ZodError);
      const issue = (e as z.ZodError).issues[0] as { params?: { code?: string } };
      expect(issue.params?.code).toBe("count_off_grid");
    }
  });
});
