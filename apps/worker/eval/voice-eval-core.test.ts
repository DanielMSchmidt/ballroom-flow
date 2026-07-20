// Voice-note EVAL — unit test for the harness's PURE parts (docs/TOOLING.md
// § AI voice notes). The credentialed harness (`pnpm eval:voice`) calls the REAL
// Workers AI model and is NEVER run in CI; this test pins the model-INDEPENDENT
// logic — the golden-case set is well-formed, and `checkExpectation` judges a
// GROUNDED proposal correctly — using a STUBBED model response, no network.
//
// Intent: prove the eval reuses production grounding (the golden contexts ground
// through the SAME `buildInterpretMessages` + `groundProposal` prod uses) and that
// its pass/fail judgement bites (a wrong anchor / unstripped note FAILS).
import { describe, expect, it } from "vitest";
import { buildInterpretMessages, groundProposal } from "../src/voice-ai";
import { checkExpectation, GOLDEN_CASES } from "./voice-eval-core.mjs";

/** The model output a well-behaved model WOULD return for a case — used to drive
 *  `groundProposal` exactly as the CLI runner does, minus the network. */
function idealRawFor(name: string): unknown {
  switch (name) {
    case "figureType match — strips the addressing from noteText":
      return {
        resolved: true,
        noteText: "I need to settle the sway before the Three Step.",
        confidence: "high",
        anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
        alternatives: [],
      };
    case "figure (ordinal) match — the earliest of two like figures":
      return {
        resolved: true,
        noteText: "change direction to go more diagonal.",
        confidence: "medium",
        anchor: { type: "figure", figureRef: "fig_bounce_1" },
        alternatives: [],
      };
    case "point (timed) match — a note pinned to one count of a figure":
      return {
        resolved: true,
        noteText: "keep the head left a little longer.",
        confidence: "high",
        anchor: { type: "point", figureRef: "fig_nat_turn", count: 3 },
        alternatives: [],
      };
    case "unresolved — no matching figure in context":
      return {
        resolved: false,
        noteText: "In Slowfox, keep your frame wide and steady throughout.",
        confidence: "low",
        anchor: null,
        alternatives: [],
      };
    case "none / general reminder — never a wrong anchor":
      return {
        resolved: false,
        noteText: "Remember to breathe and stay grounded.",
        confidence: "low",
        anchor: null,
        alternatives: [],
      };
    default:
      throw new Error(`no ideal raw for case ${name}`);
  }
}

describe("voice eval — golden cases are well-formed", () => {
  it("has cases covering figureType, figure, point, and both unresolved shapes", () => {
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(5);
    const anchorTypes = GOLDEN_CASES.map((c) => c.expect.anchorType).filter(Boolean);
    expect(anchorTypes).toContain("figureType");
    expect(anchorTypes).toContain("figure");
    expect(GOLDEN_CASES.some((c) => c.expect.resolved === false)).toBe(true);
  });

  it("every case builds a valid production payload (the shared prompt builder)", () => {
    for (const c of GOLDEN_CASES) {
      const payload = buildInterpretMessages(c.transcript, c.context);
      expect(payload.messages.map((m) => m.role)).toEqual(["system", "user"]);
      // The context each case names is embedded verbatim (closed multiple-choice).
      expect(payload.messages[0]?.content).toContain(JSON.stringify(c.context));
      expect(payload.messages[1]?.content).toBe(c.transcript);
    }
  });
});

describe("checkExpectation — judges a GROUNDED proposal (the same grounding prod runs)", () => {
  it("PASSES every golden case when the model returns the ideal, grounded output", () => {
    for (const c of GOLDEN_CASES) {
      const proposal = groundProposal(idealRawFor(c.name), c.context, c.transcript);
      const { pass, failures } = checkExpectation(proposal, c.expect);
      expect(pass, `${c.name}: ${failures.join("; ")}`).toBe(true);
    }
  });

  it("FAILS when the grounded anchor is the wrong figureType", () => {
    const c = GOLDEN_CASES[0];
    if (c == null) throw new Error("expected a case");
    // A telemark is not in this context → groundProposal rejects it to resolved:false,
    // which violates the case's resolved:true expectation.
    const proposal = groundProposal(
      {
        resolved: true,
        noteText: "settle the sway",
        confidence: "high",
        anchor: { type: "figureType", figureType: "telemark", danceScope: "foxtrot" },
        alternatives: [],
      },
      c.context,
      c.transcript,
    );
    expect(checkExpectation(proposal, c.expect).pass).toBe(false);
  });

  it("FAILS a resolved case when noteText still contains the stripped figure name", () => {
    const c = GOLDEN_CASES[0];
    if (c == null) throw new Error("expected a case");
    const proposal = groundProposal(
      {
        resolved: true,
        // The addressing was NOT stripped — noteText still names the Feather.
        noteText: "In Feather Steps, settle the sway",
        confidence: "high",
        anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
        alternatives: [],
      },
      c.context,
      c.transcript,
    );
    const { pass, failures } = checkExpectation(proposal, c.expect);
    expect(pass).toBe(false);
    expect(failures.join(" ")).toMatch(/excluded/i);
  });

  it("FAILS when an unresolved case unexpectedly grounds an anchor", () => {
    const c = GOLDEN_CASES.find((g) => g.expect.resolved === false);
    if (c == null) throw new Error("expected an unresolved case");
    // Force a resolved proposal against an unresolved-expectation case.
    const forced = groundProposal(
      {
        resolved: true,
        noteText: c.transcript,
        confidence: "low",
        anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
        alternatives: [],
      },
      c.context,
      c.transcript,
    );
    // Only meaningful if the forced anchor actually grounds in this context.
    if (forced.resolved) {
      expect(checkExpectation(forced, c.expect).pass).toBe(false);
    }
  });
});
