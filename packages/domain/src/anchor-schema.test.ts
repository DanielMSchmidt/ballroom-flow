import { describe, expect, it } from "vitest";
import { importDomain } from "./__fixtures__";

// ─────────────────────────────────────────────────────────────────────────
// WEP-0004 (docs/concepts/annotations.md § Anchors) — timed figureType anchors (choreo-first journal links).
// docs/concepts/annotations.md § The Journal: the figureType anchor gains optional
// `count`/`role` so a count-pinned note can scope to ALL of one dance's
// choreos — but NEVER across dances (counts don't align: a Waltz Whisk's
// 1-2-3 vs its Quickstep sibling's S-Q-Q). zAnchor enforces the invariant:
// `count`/`role` require a concrete danceScope.
//
// Untimed anchors (the entire v1 corpus) must keep parsing unchanged —
// additive optional fields, no migration (lenient read posture, D7).
// ─────────────────────────────────────────────────────────────────────────

describe("WEP-0004 zAnchor: timed figureType anchors", () => {
  it("accepts a dance-scoped figureType anchor pinned to a count (+ optional role)", async () => {
    // Intent: the rushed-Whisk scenario — "count 3 of every Whisk in my Waltz
    // choreos" is a valid anchor; role narrows it to one side when set.
    const { parseAnchors } = await importDomain();
    const timed = { type: "figureType", figureType: "whisk", danceScope: "waltz", count: 3 };
    const roled = { ...timed, role: "leader" };
    expect(parseAnchors([timed])).toEqual([timed]);
    expect(parseAnchors([roled])).toEqual([roled]);
  });

  it("rejects count/role on an all-dances figureType anchor (counts don't align across dances)", async () => {
    // Intent: the invariant is structural, not UI-only — a forged/buggy client
    // payload with `danceScope:"all"` + count must fail validation at every
    // boundary that parses anchors.
    const { parseAnchors } = await importDomain();
    expect(
      parseAnchors([{ type: "figureType", figureType: "whisk", danceScope: "all", count: 3 }]),
    ).toBeNull();
    expect(
      parseAnchors([
        { type: "figureType", figureType: "whisk", danceScope: "all", role: "leader" },
      ]),
    ).toBeNull();
  });

  it("keeps parsing the untimed v1 anchor corpus unchanged (additive back-compat)", async () => {
    // Intent: every stored anchor remains valid — no migration (WEP-0004; docs/concepts/annotations.md § Anchors).
    const { parseAnchors } = await importDomain();
    const corpus = [
      { type: "point", figureRef: "fig_1", count: 2, role: "follower" },
      { type: "figure", figureRef: "fig_1" },
      { type: "figureType", figureType: "feather", danceScope: "all" },
      { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
    ];
    expect(parseAnchors(corpus)).toEqual(corpus);
  });
});
