import { describe, expect, it } from "vitest";
import {
  FEATHER_FOXTROT,
  FEATHER_WALTZ,
  importDomain,
  makeFigureTypeAnchor,
  STUDENT_FEATHER_VARIANT,
  THREE_STEP_FOXTROT,
} from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-011 — figureType annotation resolution [M1, system/developer]
// docs/concepts/annotations.md § Anchors, docs/concepts/collaboration.md § Roles,
// D29 (docs/concepts/annotations.md § Ownership & visibility), docs/system/testing.md invariant: "figureType annotation resolution (an
// `all`-dances note matches a figure of that family in ANY dance; a
// `this-dance` note matches only its dance; variants inherit figureType)".
// Identity-based (not a predicate query), pure/deterministic.
//
// Product `matchesFigureType` (M1) doesn't exist yet → dynamic import, skipped.
// Note CONTENT visibility (option 2 co-membership gate) is the worker layer
// (US-041); THIS file is pure family-matching only.
// ─────────────────────────────────────────────────────────────────────────

describe("US-011 figureType annotation resolution", () => {
  it("matches an all-dances family note on a figure of that family in ANY dance", async () => {
    // Intent: "on every Feather" matches Foxtrot Feather AND Waltz Feather.
    // Arrange: an anchor {figureType:"feather", danceScope:"all"}.
    // Act: match against FEATHER_FOXTROT and FEATHER_WALTZ.
    // Assert: both match.
    // Covers US-011 AC-1 (all-dances matches any dance).
    const { matchesFigureType } = await importDomain();
    const anchor = makeFigureTypeAnchor("feather", "all");
    expect(matchesFigureType(anchor, FEATHER_FOXTROT)).toBe(true);
    expect(matchesFigureType(anchor, FEATHER_WALTZ)).toBe(true);
  });

  it("matches a this-dance family note only in that dance", async () => {
    // Intent: a this-dance note scoped to Foxtrot must NOT match the Waltz Feather.
    // Arrange: anchor {figureType:"feather", danceScope:"foxtrot"}.
    // Act: match against the Foxtrot vs Waltz Feather.
    // Assert: Foxtrot matches; Waltz does not.
    // Covers US-011 AC-2 (this-dance matches only its dance).
    const { matchesFigureType } = await importDomain();
    const anchor = makeFigureTypeAnchor("feather", "foxtrot");
    expect(matchesFigureType(anchor, FEATHER_FOXTROT)).toBe(true);
    expect(matchesFigureType(anchor, FEATHER_WALTZ)).toBe(false);
  });

  it("does not match a different family", async () => {
    // Intent: family identity is exact (a Feather note never lands on a Three Step).
    // Arrange: a feather anchor. Act: match against THREE_STEP_FOXTROT.
    // Assert: no match.
    // Covers US-011 AC-4 (identity-based, not a predicate).
    const { matchesFigureType } = await importDomain();
    expect(matchesFigureType(makeFigureTypeAnchor("feather", "all"), THREE_STEP_FOXTROT)).toBe(
      false,
    );
  });

  it("matches a variant because it inherits its base's figureType + dance", async () => {
    // Intent: a variant inherits family identity, so family notes surface on it too.
    // Arrange: STUDENT_FEATHER_VARIANT (baseFigureRef → Foxtrot Feather).
    // Act: resolve the variant's effective figureType, match a feather anchor.
    // Assert: the variant matches the feather family (this-dance Foxtrot AND all).
    // Covers US-011 AC-3 (variants inherit figureType).
    const { matchesFigureType } = await importDomain();
    expect(
      matchesFigureType(makeFigureTypeAnchor("feather", "foxtrot"), STUDENT_FEATHER_VARIANT),
    ).toBe(true);
    expect(matchesFigureType(makeFigureTypeAnchor("feather", "all"), STUDENT_FEATHER_VARIANT)).toBe(
      true,
    );
  });

  // ── Extra edge cases (in the spirit of US-011, beyond the listed ACs) ──

  it("a this-dance note scoped to the wrong dance does not match", async () => {
    // Intent: a Feather note scoped to Waltz must NOT land on the Foxtrot Feather
    // (the dance scope is exact, in both directions).
    const { matchesFigureType } = await importDomain();
    expect(matchesFigureType(makeFigureTypeAnchor("feather", "waltz"), FEATHER_FOXTROT)).toBe(
      false,
    );
  });

  it("matches the same family across two different dances under an all-dances note", async () => {
    // Intent: identity is the family, not the dance — one all-dances note covers
    // every dance the family appears in (positively pinning the cross-dance reach).
    const { matchesFigureType } = await importDomain();
    const anchor = makeFigureTypeAnchor("feather", "all");
    expect(FEATHER_FOXTROT.dance).not.toBe(FEATHER_WALTZ.dance); // genuinely different dances
    expect(matchesFigureType(anchor, FEATHER_FOXTROT)).toBe(true);
    expect(matchesFigureType(anchor, FEATHER_WALTZ)).toBe(true);
  });

  it("does not match a non-figureType anchor", async () => {
    // Intent: only figureType anchors participate in family matching; a point
    // anchor (or any other) never matches a figure family.
    const { matchesFigureType } = await importDomain();
    const pointAnchor = { type: "point" as const, figureRef: FEATHER_FOXTROT.id, count: 1 };
    expect(matchesFigureType(pointAnchor, FEATHER_FOXTROT)).toBe(false);
  });
});

describe("WEP-0004 figureTypeNoteCount — count pinning with soft fallback", () => {
  // The fixture Feathers carry attributes on counts 1..3 (no authored length),
  // so their resolved length is 3 — count 3 pins, count 5 falls back.

  it("pins a timed dance-scoped note to its count when the figure covers it", async () => {
    // Intent: the rushed Whisk — a count-3 note surfaces PINNED on a matching
    // 3-count figure of the family in that dance.
    const { figureTypeNoteCount } = await importDomain();
    const anchor = makeFigureTypeAnchor("feather", "foxtrot", { count: 3 });
    expect(figureTypeNoteCount(anchor, FEATHER_FOXTROT)).toBe(3);
  });

  it("degrades to figure grain (null) when the figure is shorter than the count", async () => {
    // Intent: a family sibling whose variant lacks the count still SHOWS the
    // note, just un-pinned — never hidden (WEP-0004 soft fallback; docs/concepts/annotations.md § Anchors).
    const { figureTypeNoteCount, matchesFigureType } = await importDomain();
    const anchor = makeFigureTypeAnchor("feather", "foxtrot", { count: 5 });
    expect(figureTypeNoteCount(anchor, FEATHER_FOXTROT)).toBeNull();
    expect(matchesFigureType(anchor, FEATHER_FOXTROT)).toBe(true); // still surfaces
  });

  it("returns null for an untimed anchor and for a non-matching figure", async () => {
    // Intent: pinning is strictly additive — untimed notes keep figure-grain
    // surfacing; a timed note never pins onto a figure it doesn't match.
    const { figureTypeNoteCount } = await importDomain();
    expect(figureTypeNoteCount(makeFigureTypeAnchor("feather", "foxtrot"), FEATHER_FOXTROT)).toBe(
      null,
    );
    expect(
      figureTypeNoteCount(makeFigureTypeAnchor("feather", "waltz", { count: 2 }), FEATHER_FOXTROT),
    ).toBeNull();
  });
});
