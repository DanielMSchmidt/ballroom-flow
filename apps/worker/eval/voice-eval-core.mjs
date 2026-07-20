// Voice-note EVAL — the pure, model-independent core: the golden cases and the
// expectation checker. Kept plain-Node (no TS import) so BOTH the CLI runner
// (`voice-eval.mjs`, which adds the real Workers AI call) and the unit test
// (`voice-eval-core.test.ts`, which drives it with a stubbed grounded proposal)
// share the exact same case set + pass/fail logic. See docs/TOOLING.md
// § AI voice notes for how to run the credentialed harness.
//
// Each golden case names a transcript + a ChoreoContext and the expectation the
// GROUNDED proposal must satisfy. The grounding (groundProposal — the same Zod
// re-validation + context grounding prod uses) happens in the runner; this module
// only judges the resulting VoiceNoteProposal.

/**
 * @typedef {object} GoldenExpect
 * @property {boolean} resolved                  Whether an anchor must ground.
 * @property {"point"|"figure"|"figureType"} [anchorType]  Required grounded anchor type.
 * @property {string} [figureType]               Required figureType (figureType anchors).
 * @property {string} [figureRef]                Required figureRef (figure/point anchors).
 * @property {string} [danceScope]               Required danceScope (figureType anchors).
 * @property {string|RegExp} [noteTextMatches]   Substring / regex the noteText must satisfy.
 * @property {string|RegExp} [noteTextExcludes]  Substring / regex the noteText must NOT contain.
 */

/**
 * The golden set (inline so the harness is self-contained). Contexts are plain
 * `ChoreoContext` objects — the same shape `serializeChoreoContext` emits — so
 * the model receives production-identical grounding. Covers: a figureType match
 * with addressing-strip, a `figure` (ordinal/instance) match, a `point` (timed)
 * match, an unresolved (no matching figure) case, and an ambiguous "none" case.
 * @type {{ name: string, transcript: string, context: import("@weavesteps/domain").ChoreoContext, expect: GoldenExpect }[]}
 */
export const GOLDEN_CASES = [
  {
    name: "figureType match — strips the addressing from noteText",
    transcript: "In Slowfox, in Feather Steps, I need to settle the sway before the Three Step.",
    context: {
      dances: [{ id: "foxtrot", name: "Foxtrot", aliases: ["slowfox", "slow foxtrot"] }],
      choreos: [
        {
          id: "rt_a",
          name: "Foxtrot A",
          dance: "foxtrot",
          figures: [
            { figureRef: "fig_feather_a", figureType: "feather", name: "Feather Step", counts: [] },
          ],
        },
      ],
    },
    expect: {
      resolved: true,
      anchorType: "figureType",
      figureType: "feather",
      danceScope: "foxtrot",
      noteTextMatches: /settle the sway/i,
      noteTextExcludes: /feather/i,
    },
  },
  {
    name: "figure (ordinal) match — the earliest of two like figures",
    transcript:
      "In my competition slowfox, on the first bounce fallaway, change direction to go more diagonal.",
    context: {
      dances: [{ id: "foxtrot", name: "Foxtrot", aliases: ["slowfox"] }],
      choreos: [
        {
          id: "rt_comp",
          name: "Comp Slowfox",
          dance: "foxtrot",
          figures: [
            {
              figureRef: "fig_bounce_1",
              figureType: "bounce_fallaway",
              name: "Bounce Fallaway",
              counts: [],
            },
            {
              figureRef: "fig_bounce_2",
              figureType: "bounce_fallaway",
              name: "Bounce Fallaway",
              counts: [],
            },
          ],
        },
      ],
    },
    expect: {
      resolved: true,
      anchorType: "figure",
      figureRef: "fig_bounce_1",
      noteTextMatches: /more diagonal/i,
      noteTextExcludes: /bounce fallaway/i,
    },
  },
  {
    name: "point (timed) match — a note pinned to one count of a figure",
    transcript: "On count 3 of the Natural Turn, keep the head left a little longer.",
    context: {
      dances: [{ id: "waltz", name: "Waltz", aliases: ["slow waltz"] }],
      choreos: [
        {
          id: "rt_waltz",
          name: "Waltz Routine",
          dance: "waltz",
          figures: [
            {
              figureRef: "fig_nat_turn",
              figureType: "natural_turn",
              name: "Natural Turn",
              counts: [
                { count: 1, attributes: [] },
                { count: 2, attributes: [] },
                { count: 3, attributes: [] },
              ],
            },
          ],
        },
      ],
    },
    expect: {
      resolved: true,
      // Accept either a timed point on count 3 OR a figure/figureType on the
      // Natural Turn — models legitimately vary in granularity, and the harness
      // pins the load-bearing property (grounds to the Natural Turn, note stripped)
      // rather than over-constraining the anchor shape. See checker's anchorType.
      figureRef: "fig_nat_turn",
      noteTextMatches: /head left/i,
      noteTextExcludes: /natural turn/i,
    },
  },
  {
    name: "unresolved — no matching figure in context",
    transcript: "In Slowfox, keep your frame wide and steady throughout.",
    context: {
      dances: [{ id: "foxtrot", name: "Foxtrot", aliases: ["slowfox"] }],
      choreos: [
        {
          id: "rt_a",
          name: "Foxtrot A",
          dance: "foxtrot",
          figures: [
            { figureRef: "fig_feather_a", figureType: "feather", name: "Feather Step", counts: [] },
          ],
        },
      ],
    },
    // Nothing to anchor to → resolved:false with the WHOLE transcript kept.
    expect: {
      resolved: false,
      noteTextMatches: /keep your frame wide/i,
    },
  },
  {
    name: "none / general reminder — never a wrong anchor",
    transcript: "Remember to breathe and stay grounded.",
    context: {
      dances: [{ id: "foxtrot", name: "Foxtrot", aliases: ["slowfox"] }],
      choreos: [
        {
          id: "rt_a",
          name: "Foxtrot A",
          dance: "foxtrot",
          figures: [
            { figureRef: "fig_feather_a", figureType: "feather", name: "Feather Step", counts: [] },
          ],
        },
      ],
    },
    expect: {
      resolved: false,
      noteTextMatches: /breathe/i,
    },
  },
];

/** Does `text` satisfy `matcher` (a substring, case-insensitively, or a regex)? */
function matches(text, matcher) {
  if (matcher instanceof RegExp) return matcher.test(text);
  return text.toLowerCase().includes(matcher.toLowerCase());
}

/**
 * Judge a single grounded proposal against a case's expectation. PURE — takes the
 * already-grounded `VoiceNoteProposal` (from `groundProposal`) so it is testable
 * with a stubbed proposal, no model needed. Returns the pass/fail plus the reasons
 * for any failure (so the CLI can print a diagnosis).
 *
 * @param {import("@weavesteps/contract").VoiceNoteProposal} proposal
 * @param {GoldenExpect} expect
 * @returns {{ pass: boolean, failures: string[] }}
 */
export function checkExpectation(proposal, expect) {
  const failures = [];

  if (proposal.resolved !== expect.resolved) {
    failures.push(`resolved: got ${proposal.resolved}, want ${expect.resolved}`);
  }

  if (expect.resolved) {
    const anchor = proposal.proposed?.anchor ?? null;
    if (anchor == null) {
      failures.push("expected a grounded anchor, got none");
    } else {
      if (expect.anchorType != null && anchor.type !== expect.anchorType) {
        failures.push(`anchor.type: got ${anchor.type}, want ${expect.anchorType}`);
      }
      if (expect.figureType != null) {
        const got = anchor.type === "figureType" ? anchor.figureType : undefined;
        if (got !== expect.figureType) {
          failures.push(`figureType: got ${String(got)}, want ${expect.figureType}`);
        }
      }
      if (expect.danceScope != null) {
        const got = anchor.type === "figureType" ? anchor.danceScope : undefined;
        if (got !== expect.danceScope) {
          failures.push(`danceScope: got ${String(got)}, want ${expect.danceScope}`);
        }
      }
      if (expect.figureRef != null) {
        const got =
          anchor.type === "figure" || anchor.type === "point" ? anchor.figureRef : undefined;
        if (got !== expect.figureRef) {
          failures.push(`figureRef: got ${String(got)}, want ${expect.figureRef}`);
        }
      }
    }
  } else if (proposal.proposed != null) {
    failures.push("expected no proposal (resolved:false), got a grounded anchor");
  }

  if (expect.noteTextMatches != null && !matches(proposal.noteText, expect.noteTextMatches)) {
    failures.push(
      `noteText ${JSON.stringify(proposal.noteText)} did not match ${expect.noteTextMatches}`,
    );
  }
  if (expect.noteTextExcludes != null && matches(proposal.noteText, expect.noteTextExcludes)) {
    failures.push(
      `noteText ${JSON.stringify(proposal.noteText)} unexpectedly matched excluded ${expect.noteTextExcludes}`,
    );
  }

  return { pass: failures.length === 0, failures };
}
