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
import { env } from "cloudflare:test";
import type { ChoreoContext } from "@weavesteps/domain";
import { describe, expect, it } from "vitest";
import {
  buildInterpretMessages,
  EXTRACTION_JSON_SCHEMA,
  fixtureVoiceAi,
  groundProposal,
  shouldUseWorkersAi,
  VOICE_EXTRACT_MODEL,
  VOICE_STT_MODEL,
  type VoiceAiRunner,
  voiceAiFor,
  workersVoiceAi,
} from "./voice-ai";

/** A recording runner satisfying the narrow VoiceAiRunner (no cast needed). */
function recordingRunner(reply: unknown): {
  runner: VoiceAiRunner;
  calls: { model: string; options?: { gateway?: { id: string } } }[];
} {
  const calls: { model: string; options?: { gateway?: { id: string } } }[] = [];
  const runner: VoiceAiRunner = {
    async run(model, _inputs, options) {
      calls.push({ model, options });
      return reply;
    },
  };
  return { runner, calls };
}

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

describe("buildInterpretMessages — the exact payload sent to the model", () => {
  // The ONE shared prompt builder feeds prod, this test, and the eval harness, so
  // the tested prompt cannot drift from the deployed one. We pin: the serialized
  // context, the noteText-stripping instruction, the anchor-only-from-context
  // rule, the user message = the raw transcript, and the response_format schema.
  const ctx = twoFoxtrotContext();
  const transcript = "In Slowfox, in Feather Steps, settle the sway.";

  it("carries a system + user message and the json_schema response_format", () => {
    const payload = buildInterpretMessages(transcript, ctx);
    expect(payload.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(payload.response_format.type).toBe("json_schema");
    expect(payload.response_format.json_schema).toBe(EXTRACTION_JSON_SCHEMA);
  });

  it("the user message is the raw transcript, verbatim", () => {
    const payload = buildInterpretMessages(transcript, ctx);
    const userMsg = payload.messages.find((m) => m.role === "user");
    expect(userMsg?.content).toBe(transcript);
  });

  it("the system message embeds the serialized grounding context", () => {
    const payload = buildInterpretMessages(transcript, ctx);
    const system = payload.messages.find((m) => m.role === "system")?.content ?? "";
    // The whole JSON.stringify(context) must appear so the model grounds against
    // the caller's ACTUAL figures/dances (closed multiple-choice).
    expect(system).toContain(JSON.stringify(ctx));
    // And the load-bearing pieces of it individually.
    expect(system).toContain("Feather Step");
    expect(system).toContain("bounce_fallaway");
    expect(system).toContain("slowfox");
  });

  it("the system message states the noteText-stripping rule", () => {
    const system =
      buildInterpretMessages(transcript, ctx).messages.find((m) => m.role === "system")?.content ??
      "";
    expect(system).toContain("noteText");
    expect(system.toLowerCase()).toContain("strip");
    // The unresolved case keeps the whole transcript.
    expect(system.toLowerCase()).toContain("nothing to strip");
  });

  it("the system message states the anchor-only-from-context rule", () => {
    const system =
      buildInterpretMessages(transcript, ctx).messages.find((m) => m.role === "system")?.content ??
      "";
    expect(system).toContain("ONLY from the figures/dances in this context");
    expect(system).toContain("resolved:false");
  });

  it("workersVoiceAi.interpret sends EXACTLY buildInterpretMessages' payload to VOICE_EXTRACT_MODEL", async () => {
    // Drive the production seam with a capturing runner and assert the wire
    // payload IS the shared builder's output (no drift between builder and seam).
    const captured: { model: string; inputs: Record<string, unknown> }[] = [];
    const runner: VoiceAiRunner = {
      async run(model, inputs) {
        captured.push({ model, inputs });
        return { response: '{"resolved":false,"noteText":"x","confidence":"low","anchor":null}' };
      },
    };
    await workersVoiceAi(runner).interpret(transcript, ctx);
    const expected = buildInterpretMessages(transcript, ctx);
    expect(captured[0]?.model).toBe(VOICE_EXTRACT_MODEL);
    expect(captured[0]?.inputs.messages).toEqual(expected.messages);
    expect(captured[0]?.inputs.response_format).toEqual(expected.response_format);
  });
});

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

  it("scenario A: a slowfox + feather transcript → a groundable figureType/foxtrot extraction with the addressing STRIPPED from noteText", async () => {
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
    // The "In Slowfox, in Feather Steps," addressing became the anchor and is gone
    // from the note; the coaching content remains and no longer names the figure.
    expect(p.noteText).toBe("I need to settle the sway before the Three Step.");
    expect(p.noteText.toLowerCase()).not.toContain("feather");
  });

  it("scenario B: an ordinal bounce-fallaway transcript → the EARLIEST matching figure anchor with stripped noteText", async () => {
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
    expect(p.noteText).toBe("I need to change the direction to go more diagonal.");
    expect(p.noteText.toLowerCase()).not.toContain("bounce fallaway");
  });

  it("scenario C: an unresolvable transcript → resolved:false, noteText = the WHOLE transcript (nothing to strip)", async () => {
    const ctx = twoFoxtrotContext();
    const raw = await fixtureVoiceAi().interpret("Remember to breathe and stay grounded.", ctx);
    const p = groundProposal(raw, ctx, "Remember to breathe and stay grounded.");
    expect(p.resolved).toBe(false);
    expect(p.noteText).toBe("Remember to breathe and stay grounded.");
  });

  it("keeps the WHOLE transcript when the addressing resolves no figure (unresolved, don't strip)", async () => {
    const ctx = twoFoxtrotContext();
    // Names a dance clause but no figure in context → unresolved: nothing stripped.
    const t = "In Slowfox, keep your frame wide and steady.";
    const raw = await fixtureVoiceAi().interpret(t, ctx);
    const p = groundProposal(raw, ctx, t);
    expect(p.resolved).toBe(false);
    expect(p.noteText).toBe(t);
  });

  it("is stable across repeated calls", async () => {
    const ctx = twoFoxtrotContext();
    const t = "In Slowfox, in Feather Steps, settle the sway.";
    const a = await fixtureVoiceAi().interpret(t, ctx);
    const b = await fixtureVoiceAi().interpret(t, ctx);
    expect(a).toEqual(b);
  });
});

describe("voiceAiFor / shouldUseWorkersAi — implementation selection", () => {
  it("selects the fixture when no AI binding is bound (the unit/dev/e2e path)", async () => {
    // The cloudflare:test env has no `AI` binding (declared only on deployed envs).
    const selected = voiceAiFor(env);
    const bytes = new TextEncoder().encode("echo me");
    // The fixture echoes bytes; the workers impl would call a model. Zero secrets.
    expect(await selected.transcribe(bytes, { initialPrompt: "" })).toBe("echo me");
  });

  it("uses Workers AI only when a binding is present AND not under E2E", () => {
    const stubAi = { run: async () => null };
    expect(shouldUseWorkersAi({ ai: undefined, e2e: undefined })).toBe(false);
    expect(shouldUseWorkersAi({ ai: stubAi, e2e: undefined })).toBe(true);
    // The E2E harness flag forces the fixture even with a binding present.
    expect(shouldUseWorkersAi({ ai: stubAi, e2e: "1" })).toBe(false);
  });
});

describe("workersVoiceAi — the deployed-env seam", () => {
  it("calls the STT model for transcribe and passes the gateway id when set", async () => {
    const { runner, calls } = recordingRunner({ text: "transcribed" });
    const ai = workersVoiceAi(runner, "weave-steps");
    const out = await ai.transcribe(new TextEncoder().encode("bytes"), {
      initialPrompt: "Feather",
    });
    expect(out).toBe("transcribed");
    expect(calls[0]?.model).toBe(VOICE_STT_MODEL);
    expect(calls[0]?.options?.gateway?.id).toBe("weave-steps");
  });

  it("calls the extract model for interpret and OMITS the gateway when unset", async () => {
    const { runner, calls } = recordingRunner({
      response: '{"resolved":false,"noteText":"x","confidence":"low","anchor":null}',
    });
    const ai = workersVoiceAi(runner);
    const raw = await ai.interpret("hello", twoFoxtrotContext());
    expect(calls[0]?.model).toBe(VOICE_EXTRACT_MODEL);
    expect(calls[0]?.options?.gateway).toBeUndefined();
    // interpret returns the PARSED raw output for groundProposal to validate.
    const p = groundProposal(raw, twoFoxtrotContext(), "hello");
    expect(p.resolved).toBe(false);
  });
});
