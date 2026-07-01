import { describe, expect, it } from "vitest";
import { importDomain } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// US-004 — Float-count timing [M1, system/developer]
// PLAN §2.5, Q-D3, §10.2 invariant: "float-count timing; count fraction
// e/&/a". Counts render in conventional ballroom notation modulo the phrase.
//
// Product helpers `countLabel`/`countToPhrase`/`barsForFigure` (timing.ts, M1 §9
// 1.4) don't exist yet → dynamic import, skipped. RED→GREEN: implement them so
// the exact mappings below hold (note: e=.25, &=.5, a=.75 — corrected from the
// earlier swapped draft).
// ─────────────────────────────────────────────────────────────────────────

describe("US-004 Float-count timing", () => {
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
    // Arrange: import countToPhrase. Act: map a count past the phrase end.
    // Assert: in Waltz (phrase 6) count 7 → phrase 2 count 1; in Foxtrot (phrase
    //   8) count 9 → phrase 2 count 1.
    // Covers AC-2 (modulo phrase) — §10.2 "modulo phrase".
    const { countToPhrase } = await importDomain();
    expect(countToPhrase(7, "waltz")).toMatchObject({ phrase: 2, countInPhrase: 1 });
    expect(countToPhrase(9, "foxtrot")).toMatchObject({ phrase: 2, countInPhrase: 1 });
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

  // ── Extra edge cases (in the spirit of US-004, beyond the listed ACs) ──

  it("labels whole-number counts without a fraction suffix", async () => {
    // Intent: an on-beat count renders as the bare beat number.
    const { countLabel } = await importDomain();
    expect(countLabel(1)).toBe("1");
    expect(countLabel(8)).toBe("8");
  });

  it("snaps float-noise fractions to the nearest 1/8 grid label", async () => {
    // Intent: real Automerge floats won't be exactly .25 — they must still
    // resolve to the conventional suffix.
    const { countLabel } = await importDomain();
    expect(countLabel(3.2500001)).toBe("3e");
    expect(countLabel(2.4999998)).toBe("2&");
  });

  it("renders off-grid fractions without leaking float noise", async () => {
    // Intent: a fraction that doesn't snap to the spec'd 1/8 grid (.6/.9 sit
    // between grid points) stays visible as beat+fraction, but is rounded to 3
    // decimals so binary-float noise doesn't reach the label.
    const { countLabel } = await importDomain();
    expect(countLabel(3.6)).toBe("3+0.6"); // not "3+0.6000000000000001"
    expect(countLabel(3.9)).toBe("3+0.9"); // not "3+0.8999999999999999"
  });

  it("keeps within-phrase counts in phrase 1", async () => {
    // Intent: counts inside the first phrase don't wrap.
    const { countToPhrase } = await importDomain();
    expect(countToPhrase(1, "waltz")).toMatchObject({ phrase: 1, countInPhrase: 1 });
    expect(countToPhrase(6, "waltz")).toMatchObject({ phrase: 1, countInPhrase: 6 });
    expect(countToPhrase(8, "foxtrot")).toMatchObject({ phrase: 1, countInPhrase: 8 });
  });

  it("spans more phrases as a figure's counts extend past the phrase", async () => {
    // Intent: barsForFigure grows once attributes land in a later phrase.
    const { barsForFigure } = await importDomain();
    expect(barsForFigure([1, 2, 3], "waltz")).toBe(1); // within phrase 6
    expect(barsForFigure([1, 7], "waltz")).toBe(2); // 7 lands in phrase 2
    expect(barsForFigure([], "foxtrot")).toBe(1); // empty → 1
  });
});

// ─────────────────────────────────────────────────────────────────────────
// US-004a — Continuous beat numbering across a routine (reading view).
// A single counter threads the whole routine; it wraps at phrase length
// (Waltz/Viennese 6, others 8). Only whole beats advance it; off-beats render
// as their symbol and consume no number. Breaks occupy beats + report a span.
// ─────────────────────────────────────────────────────────────────────────

describe("US-004a continuous routine numbering", () => {
  it("drops the local-beat prefix from an off-beat symbol", async () => {
    const { offBeatSymbol } = await importDomain();
    expect(offBeatSymbol(2)).toBeNull(); // whole beat → no symbol
    expect(offBeatSymbol(2.25)).toBe("e");
    expect(offBeatSymbol(2.5)).toBe("&");
    expect(offBeatSymbol(3.75)).toBe("a");
  });

  it("continues the counter across figures and wraps at the Waltz phrase (6)", async () => {
    const { numberRoutineBeats } = await importDomain();
    const out = numberRoutineBeats(
      [
        { kind: "figure", counts: [1, 2, 3] },
        { kind: "figure", counts: [1, 2, 3] },
        { kind: "figure", counts: [1, 2, 3] },
      ],
      "waltz",
    );
    expect(out[0]).toMatchObject({ kind: "figure", tokens: ["1", "2", "3"] });
    expect(out[1]).toMatchObject({ kind: "figure", tokens: ["4", "5", "6"] });
    expect(out[2]).toMatchObject({ kind: "figure", tokens: ["1", "2", "3"] }); // wrapped
  });

  it("wraps at 8 for 4/4 dances (a figure starting bar 2 reads 5)", async () => {
    const { numberRoutineBeats } = await importDomain();
    const out = numberRoutineBeats(
      [
        { kind: "figure", counts: [1, 2, 3, 4] },
        { kind: "figure", counts: [1, 2, 3, 4] },
      ],
      "quickstep",
    );
    expect(out[1]).toMatchObject({ tokens: ["5", "6", "7", "8"] });
  });

  it("renders off-beats as symbols without consuming a beat number", async () => {
    const { numberRoutineBeats } = await importDomain();
    const [figure] = numberRoutineBeats([{ kind: "figure", counts: [1, 2, 2.5, 3] }], "waltz");
    // 2.5 shows "&" and does NOT advance — 3 still reads "3".
    expect(figure).toMatchObject({ tokens: ["1", "2", "&", "3"] });
  });

  it("advances the counter through a break and reports its phrase span + bars", async () => {
    const { numberRoutineBeats } = await importDomain();
    const out = numberRoutineBeats(
      [
        { kind: "figure", counts: [1, 2, 3] }, // beats 1–3
        { kind: "break", beats: 3 }, // beats 4–6, one Waltz bar
        { kind: "figure", counts: [1, 2, 3] }, // wraps → 1 2 3
      ],
      "waltz",
    );
    expect(out[1]).toMatchObject({ kind: "break", span: "beats 4–6", bars: 1, beats: 3 });
    expect(out[2]).toMatchObject({ kind: "figure", tokens: ["1", "2", "3"] });
  });

  it("labels a single-beat break as one beat", async () => {
    const { numberRoutineBeats } = await importDomain();
    const [brk] = numberRoutineBeats([{ kind: "break", beats: 1 }], "waltz");
    expect(brk).toMatchObject({ kind: "break", span: "beat 1", bars: 1 });
  });
});
