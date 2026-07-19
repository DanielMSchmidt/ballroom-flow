// AI voice notes — the VoiceAi seam, deterministic fixture, and grounding
// (docs/concepts/annotations.md § The Journal, docs/system/architecture.md).
//
// Intent: prove the two halves of "never trust the model" WITHOUT a DO or a
// network — (1) groundProposal re-validates raw model output with the contract
// schema AND grounds every ref against the assembled context, degrading to
// resolved:false on any mismatch; (2) the fixture is fully deterministic (derived
// from its inputs), so the E2E scenarios are assertable with no canned responses.
//
// Invariant pinned: zero wrong-anchor proposals escape grounding — a model
// output naming a figureRef/figureType/count NOT in the context is rejected, not
// decorated.
import type { ChoreoContext } from "@weavesteps/domain";
import { describe, expect, it } from "vitest";
import { fixtureVoiceAi, groundProposal } from "./voice-ai";

/** A two-foxtrot-routine context mirroring the E2E scenario-A/B seeds. */
function twoFoxtrotContext(): ChoreoContext {
  return {
    dances: [{ id: "foxtrot", name: "Foxtrot", aliases: ["slowfox", "slow foxtrot", "slow fox"] }],
    choreos: [
      {
        id: "rt_a",
        name: "Foxtrot A",
        dance: "foxtrot",
        figures: [
          {
            figureRef: "fig_feather_a",
            figureType: "feather",
            name: "Feather Step",
            counts: [{ count: 1, attributes: [{ kind: "sway", value: "left", role: null }] }],
          },
        ],
      },
      {
        id: "rt_comp",
        name: "Comp Slowfox",
        dance: "foxtrot",
        figures: [
          {
            figureRef: "fig_bounce_1",
            figureType: "bounce_fallaway",
            name: "Bounce Fallaway",
            counts: [{ count: 1, attributes: [] }],
          },
          {
            figureRef: "fig_bounce_2",
            figureType: "bounce_fallaway",
            name: "Bounce Fallaway",
            counts: [{ count: 1, attributes: [] }],
          },
        ],
      },
    ],
  };
}

describe("groundProposal — the mandatory re-validation + grounding", () => {
  it("degrades non-parsing model output to resolved:false with noteText = transcript", () => {
    const p = groundProposal({ not: "a valid extraction" }, twoFoxtrotContext(), "hello there");
    expect(p.resolved).toBe(false);
    expect(p.proposed).toBeNull();
    expect(p.noteText).toBe("hello there");
    expect(p.confidence).toBe("low");
  });

  it("rejects a schema-valid extraction whose figureRef is NOT in the context", () => {
    const raw = {
      resolved: true,
      noteText: "more diagonal",
      confidence: "high",
      anchor: { type: "figure", figureRef: "fig_not_here" },
    };
    const p = groundProposal(raw, twoFoxtrotContext(), "more diagonal");
    expect(p.resolved).toBe(false);
    expect(p.proposed).toBeNull();
  });

  it("rejects a figureType not present in the context", () => {
    const raw = {
      resolved: true,
      noteText: "x",
      confidence: "high",
      anchor: { type: "figureType", figureType: "telemark", danceScope: "foxtrot" },
    };
    expect(groundProposal(raw, twoFoxtrotContext(), "x").resolved).toBe(false);
  });

  it("rejects a point count the referenced figure doesn't chart", () => {
    const raw = {
      resolved: true,
      noteText: "x",
      confidence: "high",
      anchor: { type: "point", figureRef: "fig_feather_a", count: 9 },
    };
    expect(groundProposal(raw, twoFoxtrotContext(), "x").resolved).toBe(false);
  });

  it("accepts + decorates a valid figureType extraction (family label, routineRef null)", () => {
    const raw = {
      resolved: true,
      noteText: "settle the sway",
      confidence: "high",
      anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
    };
    const p = groundProposal(raw, twoFoxtrotContext(), "in slowfox settle the sway");
    expect(p.resolved).toBe(true);
    expect(p.proposed?.anchor.type).toBe("figureType");
    expect(p.proposed?.routineRef).toBeNull();
    expect(p.proposed?.label).toContain("Feather");
  });

  it("accepts + decorates a valid figure extraction (routineRef = owning choreo)", () => {
    const raw = {
      resolved: true,
      noteText: "more diagonal",
      confidence: "medium",
      anchor: { type: "figure", figureRef: "fig_bounce_1" },
    };
    const p = groundProposal(
      raw,
      twoFoxtrotContext(),
      "on the first bounce fallaway more diagonal",
    );
    expect(p.resolved).toBe(true);
    expect(p.proposed?.routineRef).toBe("rt_comp");
    expect(p.proposed?.label).toContain("Comp Slowfox");
  });
});

describe("fixtureVoiceAi — deterministic, derived from inputs", () => {
  it("transcribe echoes the UTF-8 bytes", async () => {
    const ai = fixtureVoiceAi();
    const bytes = new TextEncoder().encode("in slowfox settle the sway");
    expect(await ai.transcribe(bytes, { initialPrompt: "" })).toBe("in slowfox settle the sway");
  });

  it("scenario A: a slowfox + feather transcript → a groundable figureType/foxtrot extraction", async () => {
    const ctx = twoFoxtrotContext();
    const raw = await fixtureVoiceAi().interpret(
      "In Slowfox, in Feather Steps, I need to settle the sway before the Three Step.",
      ctx,
    );
    const p = groundProposal(raw, ctx, "…");
    expect(p.resolved).toBe(true);
    expect(p.proposed?.anchor.type).toBe("figureType");
    if (p.proposed?.anchor.type === "figureType") {
      expect(p.proposed.anchor.figureType).toBe("feather");
      expect(p.proposed.anchor.danceScope).toBe("foxtrot");
    }
  });

  it("scenario B: an ordinal bounce-fallaway transcript → the EARLIEST matching figure anchor", async () => {
    const ctx = twoFoxtrotContext();
    const raw = await fixtureVoiceAi().interpret(
      "In my competition slowfox, on the first bounce fallaway, I need to change the direction to go more diagonal.",
      ctx,
    );
    const p = groundProposal(raw, ctx, "…");
    expect(p.resolved).toBe(true);
    expect(p.proposed?.anchor.type).toBe("figure");
    if (p.proposed?.anchor.type === "figure") {
      expect(p.proposed.anchor.figureRef).toBe("fig_bounce_1");
    }
  });

  it("scenario C: an unresolvable transcript → resolved:false", async () => {
    const ctx = twoFoxtrotContext();
    const raw = await fixtureVoiceAi().interpret("Remember to breathe and stay grounded.", ctx);
    expect(groundProposal(raw, ctx, "Remember to breathe and stay grounded.").resolved).toBe(false);
  });

  it("is stable across repeated calls", async () => {
    const ctx = twoFoxtrotContext();
    const t = "In Slowfox, in Feather Steps, settle the sway.";
    const a = await fixtureVoiceAi().interpret(t, ctx);
    const b = await fixtureVoiceAi().interpret(t, ctx);
    expect(a).toEqual(b);
  });
});
