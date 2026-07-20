// AI voice notes (docs/ideas/ai-voice-notes.md → folded into
// docs/concepts/annotations.md § The Journal + docs/system/architecture.md).
//
// Intent: prove the PURE choreo-context serializer that grounds the voice-note
// extraction model against the ACTUAL figures in a user's choreos — figures in
// placement order (one entry per placement so ordinals ground), tombstones
// dropped, variants resolved live against their base, counts + attributes
// carried, and the in-scope dance table with spoken aliases. Also the
// dance-alias resolver (a new hand-curated table — nothing like it existed).
//
// Invariant pinned: serialization is deterministic and detached from I/O (no
// Date.now/randomness), so the same in-scope choreography always yields the same
// grounding context — the model's multiple-choice never shifts under it.
import { describe, expect, it } from "vitest";
import {
  makeAttribute,
  makeFigureDoc,
  makePlacement,
  makeRoutineDoc,
  makeSection,
  makeVariantDoc,
} from "./__fixtures__";
import type { FigureDoc, Placement, Section } from "./doc-types";
import {
  type ChoreoContext,
  DANCE_ALIASES,
  resolveDanceAlias,
  serializeChoreoContext,
} from "./voice-context";

/** makeSection/makePlacement drop `sortKey`; re-apply it explicitly. */
function withKey<T extends Section | Placement>(entity: T, sortKey: string): T {
  return { ...entity, sortKey };
}

/** Non-null accessor for indexed reads (noUncheckedIndexedAccess) — throws
 *  loudly rather than asserting, so a missing element fails the test honestly. */
function nn<T>(x: T | undefined): T {
  if (x === undefined) throw new Error("expected a value, got undefined");
  return x;
}

function figuresFrom(figures: FigureDoc[]): Record<string, FigureDoc> {
  const map: Record<string, FigureDoc> = {};
  for (const f of figures) map[f.id] = f;
  return map;
}

describe("resolveDanceAlias", () => {
  it("resolves ids, display names, and spoken aliases case-insensitively", () => {
    expect(resolveDanceAlias("Slowfox")).toBe("foxtrot");
    expect(resolveDanceAlias("slow foxtrot")).toBe("foxtrot");
    expect(resolveDanceAlias("foxtrot")).toBe("foxtrot");
    expect(resolveDanceAlias("waltz")).toBe("waltz");
    expect(resolveDanceAlias("Viennese")).toBe("viennese_waltz");
    expect(resolveDanceAlias("quickstep")).toBe("quickstep");
  });

  it("returns null for an unknown or out-of-scope dance", () => {
    expect(resolveDanceAlias("salsa")).toBeNull();
    expect(resolveDanceAlias("")).toBeNull();
  });

  it("exposes an alias table keyed by every DanceId", () => {
    expect(DANCE_ALIASES.foxtrot).toContain("slowfox");
    expect(Object.keys(DANCE_ALIASES).sort()).toEqual(
      ["foxtrot", "quickstep", "tango", "viennese_waltz", "waltz"].sort(),
    );
  });
});

describe("serializeChoreoContext", () => {
  it("emits figures in placement order, one entry PER placement", () => {
    const feather = makeFigureDoc({
      id: "fig_feather",
      figureType: "feather",
      name: "Feather Step",
    });
    const three = makeFigureDoc({ id: "fig_three", figureType: "three_step", name: "Three Step" });
    // Two sections, sortKey-shuffled; feather placed twice.
    const routine = makeRoutineDoc({
      id: "rt_fox",
      dance: "foxtrot",
      title: "Foxtrot A",
      sections: [
        withKey(
          makeSection({
            id: "sec_b",
            placements: [withKey(makePlacement("fig_three", { id: "p_three" }), "a1")],
          }),
          "a2",
        ),
        withKey(
          makeSection({
            id: "sec_a",
            placements: [
              withKey(makePlacement("fig_feather", { id: "p_f1" }), "a1"),
              withKey(makePlacement("fig_feather", { id: "p_f2" }), "a2"),
            ],
          }),
          "a1",
        ),
      ],
    });
    const ctx = serializeChoreoContext([{ routine, figures: figuresFrom([feather, three]) }]);
    expect(ctx.choreos).toHaveLength(1);
    const figs = nn(ctx.choreos[0]).figures;
    // sec_a before sec_b (sortKey), feather twice, then three_step.
    expect(figs.map((f) => f.figureType)).toEqual(["feather", "feather", "three_step"]);
    expect(figs.map((f) => f.name)).toEqual(["Feather Step", "Feather Step", "Three Step"]);
  });

  it("drops tombstoned placements/sections/attributes and skips breaks", () => {
    const feather = makeFigureDoc({
      id: "fig_feather",
      figureType: "feather",
      name: "Feather Step",
      attributes: [
        makeAttribute({ kind: "footwork", count: 1, value: "HT" }),
        makeAttribute({ kind: "sway", count: 2, value: "left", deletedAt: 123 }),
      ],
    });
    const routine = makeRoutineDoc({
      id: "rt_fox",
      dance: "foxtrot",
      sections: [
        withKey(
          makeSection({
            id: "sec_dead",
            deletedAt: 5,
            placements: [withKey(makePlacement("fig_feather", { id: "p_dead_sec" }), "a1")],
          }),
          "a0",
        ),
        withKey(
          makeSection({
            id: "sec_live",
            placements: [
              withKey(makePlacement("fig_feather", { id: "p_live" }), "a1"),
              withKey(makePlacement("fig_feather", { id: "p_gone", deletedAt: 7 }), "a2"),
              { id: "p_break", source: "break", beats: 2, sortKey: "a3", deletedAt: null },
            ],
          }),
          "a1",
        ),
      ],
    });
    const ctx = serializeChoreoContext([{ routine, figures: figuresFrom([feather]) }]);
    const figs = nn(ctx.choreos[0]).figures;
    expect(figs).toHaveLength(1); // only the live, non-break placement in the live section
    // Tombstoned attribute dropped; only the live count survives.
    expect(nn(figs[0]).counts.map((c) => c.count)).toEqual([1]);
    expect(nn(nn(figs[0]).counts[0]).attributes).toEqual([
      { kind: "footwork", value: "HT", role: null },
    ]);
  });

  it("groups counts ascending with their live attributes", () => {
    const fig = makeFigureDoc({
      id: "fig_x",
      figureType: "feather",
      name: "Feather Step",
      attributes: [
        makeAttribute({ kind: "sway", count: 3, value: "right", role: "leader" }),
        makeAttribute({ kind: "footwork", count: 1, value: "HT" }),
        makeAttribute({ kind: "rise", count: 1, value: "NFR" }),
      ],
    });
    const routine = makeRoutineDoc({
      id: "rt_fox",
      dance: "foxtrot",
      sections: [
        makeSection({
          sortKey: "a1",
          placements: [makePlacement("fig_x", { sortKey: "a1" })],
        }),
      ],
    });
    const ctx = serializeChoreoContext([{ routine, figures: figuresFrom([fig]) }]);
    const counts = nn(nn(ctx.choreos[0]).figures[0]).counts;
    expect(counts.map((c) => c.count)).toEqual([1, 3]);
    expect(nn(counts[0]).attributes).toEqual([
      { kind: "footwork", value: "HT", role: null },
      { kind: "rise", value: "NFR", role: null },
    ]);
    expect(nn(counts[1]).attributes).toEqual([{ kind: "sway", value: "right", role: "leader" }]);
  });

  it("resolves a variant against its supplied base (owned + live beats)", () => {
    // Base charts beats 1..3; variant owns beat 2 only (a different sway).
    const base = makeFigureDoc({
      id: "fig_base",
      figureType: "feather",
      name: "Feather Step",
      attributes: [
        makeAttribute({ kind: "footwork", count: 1, value: "HT" }),
        makeAttribute({ kind: "sway", count: 2, value: "left" }),
        makeAttribute({ kind: "footwork", count: 3, value: "TH" }),
      ],
    });
    const variant = makeVariantDoc("fig_base", "user_student", {
      id: "fig_var",
      figureType: "feather",
      name: "Feather Step",
      attributes: [makeAttribute({ kind: "sway", count: 2, value: "right" })],
    });
    const routine = makeRoutineDoc({
      id: "rt_fox",
      dance: "foxtrot",
      sections: [
        makeSection({
          sortKey: "a1",
          placements: [makePlacement("fig_var", { sortKey: "a1" })],
        }),
      ],
    });
    const ctx = serializeChoreoContext([
      {
        routine,
        figures: figuresFrom([variant]),
        bases: { fig_var: base },
      },
    ]);
    const counts = nn(nn(ctx.choreos[0]).figures[0]).counts;
    // Beat 1 + 3 live from base, beat 2 owned from variant.
    expect(counts.map((c) => c.count)).toEqual([1, 2, 3]);
    expect(nn(counts[1]).attributes).toEqual([{ kind: "sway", value: "right", role: null }]);
    expect(nn(counts[0]).attributes).toEqual([{ kind: "footwork", value: "HT", role: null }]);
    expect(nn(counts[2]).attributes).toEqual([{ kind: "footwork", value: "TH", role: null }]);
  });

  it("lists exactly the dances present with their aliases", () => {
    const feather = makeFigureDoc({ id: "fig_f", dance: "foxtrot", name: "Feather Step" });
    const routine = makeRoutineDoc({
      id: "rt_fox",
      dance: "foxtrot",
      sections: [
        makeSection({ sortKey: "a1", placements: [makePlacement("fig_f", { sortKey: "a1" })] }),
      ],
    });
    const ctx = serializeChoreoContext([{ routine, figures: figuresFrom([feather]) }]);
    expect(ctx.dances.map((d) => d.id)).toEqual(["foxtrot"]);
    const [foxtrot] = ctx.dances;
    expect(foxtrot?.aliases).toContain("slowfox");
    expect((foxtrot?.name ?? "").length).toBeGreaterThan(0);
  });

  it("is a pure function — same input twice → deeply equal output", () => {
    const fig = makeFigureDoc({ id: "fig_f", dance: "foxtrot", name: "Feather Step" });
    const routine = makeRoutineDoc({
      id: "rt_fox",
      dance: "foxtrot",
      sections: [
        makeSection({ sortKey: "a1", placements: [makePlacement("fig_f", { sortKey: "a1" })] }),
      ],
    });
    const input = [{ routine, figures: figuresFrom([fig]) }];
    const a: ChoreoContext = serializeChoreoContext(input);
    const b: ChoreoContext = serializeChoreoContext(input);
    expect(a).toEqual(b);
  });
});
