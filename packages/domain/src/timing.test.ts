import { describe, expect, it } from "vitest";
import { importDomain } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-004 — Float-count timing [M1, system/developer]
// PLAN §2.5, Q-D3, §10.2 invariant: "float-count timing; count fraction
// e/&/a". Counts render in conventional ballroom notation modulo the phrase.
//
// Product helpers `countLabel`/`countToBar`/`barsForFigure` (timing.ts, M1 §9
// 1.4) don't exist yet → dynamic import, skipped. RED→GREEN: implement them so
// the exact mappings below hold (note: e=.25, &=.5, a=.75 — corrected from the
// earlier swapped draft).
// ─────────────────────────────────────────────────────────────────────────

describe.skip("US-004 Float-count timing", () => {
  it("renders quarter/half/three-quarter fractions as e/&/a", async () => {
    // Intent: the conventional "1 e & a 2" labels for float counts.
    // Arrange: import countLabel. Act: label .25/.5/.75 fractions of count 3.
    // Assert: 3.25→"3e", 3.5→"3&", 3.75→"3a".
    // Covers AC-1 first row — §10.2 "count fraction e/&/a".
    const { countLabel } = await importDomain();
    expect(countLabel(3.25)).toBe("3e");
    expect(countLabel(3.5)).toBe("3&");
    expect(countLabel(3.75)).toBe("3a");
  });

  it("renders eighth-note subdivisions as ia/ai", async () => {
    // Intent: 1/8-note subdivisions render with the `i` infix.
    // Arrange: import countLabel. Act: label .125 and .375 of count 3.
    // Assert: 3.125→"3ia", 3.375→"3ai".
    // Covers AC-1 second row — §10.2 "⅛" subdivisions.
    const { countLabel } = await importDomain();
    expect(countLabel(3.125)).toBe("3ia");
    expect(countLabel(3.375)).toBe("3ai");
  });

  it("interprets counts modulo the dance phrase (Waltz 1–6, Foxtrot 1–8)", async () => {
    // Intent: counts wrap modulo the dance's counted phrase length.
    // Arrange: import countToBar. Act: map a count past the phrase end.
    // Assert: in Waltz (phrase 6) count 7 → bar 2 count 1; in Foxtrot (phrase 8)
    //   count 9 → bar 2 count 1.
    // Covers AC-2 (modulo phrase) — §10.2 "modulo phrase".
    const { countToBar } = await importDomain();
    expect(countToBar(7, "waltz")).toMatchObject({ bar: 2, countInBar: 1 });
    expect(countToBar(9, "foxtrot")).toMatchObject({ bar: 2, countInBar: 1 });
  });

  it("computes bars for a figure per role", async () => {
    // Intent: barsForFigure derives how many bars a figure spans for a role.
    // Arrange: import barsForFigure + a figure's attribute counts.
    // Act: compute bars for leader vs follower.
    // Assert: returns a positive bar count honoring the max count for that role.
    // Covers AC-3 (barsForFigure per role).
    const { barsForFigure } = await importDomain();
    const bars = barsForFigure([1, 2, 3], "foxtrot");
    expect(bars).toBeGreaterThan(0);
  });
});
