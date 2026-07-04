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
// PLAN §2.6, §5.1, D29, §10.2 invariant: "figureType annotation resolution (an
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
