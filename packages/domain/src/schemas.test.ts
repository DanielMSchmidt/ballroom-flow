import { describe, expect, it } from "vitest";
import { z } from "zod";
import { importDomain } from "./__fixtures__";
import { isPlainRecord } from "./guards";

/** The first issue's `params` bag — domain-rule ZodErrors carry a stable
 *  `code` (+ the offending data) there. Runtime-narrowed, no casts. */
function firstIssueParams(e: unknown): Record<string, unknown> | undefined {
  const issue = e instanceof z.ZodError ? e.issues[0] : undefined;
  return isPlainRecord(issue) && isPlainRecord(issue.params) ? issue.params : undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// US-012 — Zod schemas (lenient read / strict write) [M1, system/developer]
// PLAN §3, D7, §10.2 invariant: "unknown passthrough-on-read vs reject-on-write;
// diag_*→diagonal; timing range per meter". Schemas are derived from the merged registry.
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

  it("rejects an unknown value written to a known CLOSED-enum kind on WRITE", async () => {
    // Intent: writes to a closed-enum kind are validated against the vocabulary.
    // Arrange: an unknown value for `position` (a closed enum: closed/promenade/wing).
    // Act: parse with the strict WRITE schema. Assert: it throws.
    // Covers US-012 AC-2 second half (reject on write) — §10.2 "reject-on-write".
    // (Uses `position`, not `step`: step is free-text per §3/#83 — see below.)
    const { parseAttributeWrite } = await importDomain();
    expect(() =>
      parseAttributeWrite({ id: "a1", kind: "position", count: 1, value: "NOT_A_POSITION" }),
    ).toThrow();
  });

  it("accepts a free-text value for the step kind on WRITE (§3 'controlled vocab + free-text')", async () => {
    // Intent: step is free-text (#83) — its registry values are SUGGESTIONS, so a
    //   custom footwork action writes through, while other enum kinds stay closed.
    // Covers #83 (step free-text on the domain write-check).
    const { parseAttributeWrite } = await importDomain();
    const ok = parseAttributeWrite({ id: "a1", kind: "step", count: 1, value: "brush_tap" });
    expect(ok.value).toBe("brush_tap");
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

  it("normalizes the legacy diag_back → `diagonal_back` on read (⟳2026-07-10)", async () => {
    // Intent: alias normalization happens at the schema boundary too.
    // Arrange: a direction attribute with the legacy value "diag_back".
    // Act: parse with the read schema. Assert: normalized to the ISTD split value.
    const { parseAttributeRead } = await importDomain();
    const parsed = parseAttributeRead({
      id: "a1",
      kind: "direction",
      count: 1,
      value: "diag_back",
    });
    expect(parsed.value).toBe("diagonal_back");
  });

  it("passes a legacy CBP value through on read (CBP is no longer recognized)", async () => {
    // Intent: "remove CBP." The CBP→CBMP alias is gone; a legacy bodyActions
    // "CBP" survives a read unchanged (lenient read), it is NOT rewritten.
    const { parseAttributeRead } = await importDomain();
    const parsed = parseAttributeRead({ id: "a1", kind: "bodyActions", count: 1, value: "CBP" });
    expect(parsed.value).toBe("CBP");
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

  it("accepts CBMP as a position value, and rejects it (and CBP) as a body action", async () => {
    // Intent: "CBMP is a position; remove CBP." CBMP is a known `position` value
    // (write accepted); `bodyActions` now closes to CBM only, so writing CBMP or
    // the removed CBP to bodyActions is rejected by the strict enum check.
    const { parseAttributeWrite } = await importDomain();
    expect(parseAttributeWrite({ id: "a1", kind: "position", count: 1, value: "CBMP" }).value).toBe(
      "CBMP",
    );
    expect(() =>
      parseAttributeWrite({ id: "a2", kind: "bodyActions", count: 1, value: "CBMP" }),
    ).toThrow();
    expect(() =>
      parseAttributeWrite({ id: "a3", kind: "bodyActions", count: 1, value: "CBP" }),
    ).toThrow();
  });

  it("accepts the ISTD split diagonals on the closed direction enum (⟳2026-07-10)", async () => {
    // Intent: direction is the step's relative translation — the ISTD set includes
    // diagonal_forward/diagonal_back as first-class closed-enum members; junk that
    // was never a direction (a removed footPosition ballet value) is rejected.
    const { parseAttributeWrite } = await importDomain();
    expect(
      parseAttributeWrite({ id: "a1", kind: "direction", count: 1, value: "diagonal_forward" })
        .value,
    ).toBe("diagonal_forward");
    expect(
      parseAttributeWrite({ id: "a2", kind: "direction", count: 1, value: "diagonal_back" }).value,
    ).toBe("diagonal_back");
    expect(() =>
      parseAttributeWrite({ id: "a3", kind: "direction", count: 1, value: "fourth_closed" }),
    ).toThrow();
  });

  it("normalizes the legacy diag_forward → `diagonal_forward` on write, then accepts it", async () => {
    // Intent: the alias normalizes before the strict enum check, so writing a
    // legacy diag_forward to the closed `direction` enum succeeds, stored canonical.
    const { parseAttributeWrite } = await importDomain();
    const ok = parseAttributeWrite({
      id: "a1",
      kind: "direction",
      count: 1,
      value: "diag_forward",
    });
    expect(ok.value).toBe("diagonal_forward");
  });

  it("rejects a kind whose appliesToDances EXCLUDES the figure's dance on write (rise omits Tango)", async () => {
    // Intent: a kind that does not apply to the figure's dance is rejected on the
    // WRITE path — `rise` has appliesToDances = the 4 swing dances, omitting Tango
    // (§3, §10.2). The reading view only HIDES the column; this closes the write gap
    // so a rise value can never be persisted onto a Tango figure (T9a / T3 review).
    const { parseAttributeWrite } = await importDomain();
    try {
      parseAttributeWrite({ id: "a1", kind: "rise", count: 1, value: "up" }, { dance: "tango" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(z.ZodError);
      const params = firstIssueParams(e);
      expect(params?.code).toBe("dance_not_applicable");
      expect(params?.kind).toBe("rise");
      expect(params?.dance).toBe("tango");
    }
  });

  it("still accepts rise on a Waltz figure, and a non-rise kind on a Tango figure (no over-rejection)", async () => {
    // Intent: the dance gate only blocks the inapplicable kind — valid writes pass.
    //   • rise on Waltz (a swing dance) → accepted.
    //   • position on Tango (rise-omitting, but position applies everywhere) → accepted.
    const { parseAttributeWrite } = await importDomain();
    expect(
      parseAttributeWrite({ id: "a1", kind: "rise", count: 1, value: "up" }, { dance: "waltz" })
        .value,
    ).toBe("up");
    expect(
      parseAttributeWrite(
        { id: "a2", kind: "position", count: 1, value: "closed" },
        { dance: "tango" },
      ).value,
    ).toBe("closed");
  });

  it("does not apply the dance gate when no dance context is given (structural-only write)", async () => {
    // Intent: without a dance, the figure's dance is unknown, so the gate is
    // permissive (the DO/store always supply the figure's dance — this is the
    // forward-compatible default, matching the timing check which is dance-scoped too).
    const { parseAttributeWrite } = await importDomain();
    expect(parseAttributeWrite({ id: "a1", kind: "rise", count: 1, value: "up" }).value).toBe("up");
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

    // (b) invalid value (closed-enum kind) → ZodError with params.code "unknown_value"
    try {
      parseAttributeWrite({ id: "a1", kind: "position", count: 1, value: "NOT_A_POSITION" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(z.ZodError);
      const params = firstIssueParams(e);
      expect(params?.code).toBe("unknown_value");
      expect(params?.kind).toBe("position");
    }

    // (c) off-grid count → ZodError with params.code "count_off_grid"
    try {
      parseAttributeWrite({ id: "a1", kind: "step", count: 3.3, value: "HT" }, { dance: "waltz" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(z.ZodError);
      expect(firstIssueParams(e)?.code).toBe("count_off_grid");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Builder v3 ② (owner-approved 2026-07-07) — presence attributes: `value: null`
// is a legal WRITE for any kind ("present, no value yet" — the editor's dashed
// ring). The enum-membership check applies only once a value is actually set.
// ─────────────────────────────────────────────────────────────────────────
describe("presence attributes — value:null writes (Builder v3 ②)", () => {
  it("accepts a null value for a closed enum kind (rise)", async () => {
    const { parseAttributeWrite } = await importDomain();
    const attr = parseAttributeWrite(
      { id: "a1", kind: "rise", count: 1, value: null },
      { dance: "waltz" },
    );
    expect(attr.value).toBeNull();
  });

  it("still rejects a non-null unknown value for a closed enum kind", async () => {
    const { parseAttributeWrite } = await importDomain();
    expect(() =>
      parseAttributeWrite({ id: "a1", kind: "rise", count: 1, value: "bogus" }, { dance: "waltz" }),
    ).toThrow();
  });

  it("a presence attribute still counts toward the figure's default length", async () => {
    const { defaultFigureCounts } = await importDomain();
    expect(
      defaultFigureCounts([
        { id: "a1", kind: "rise", count: 1, value: null, role: null, deletedAt: null },
        { id: "a2", kind: "rise", count: 2, value: null, role: null, deletedAt: null },
      ]),
    ).toBe(2);
  });
});
