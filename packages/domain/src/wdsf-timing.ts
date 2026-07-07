import type { DanceId } from "./dances";
import type { Attribute } from "./doc-types";
import { authoredSteps } from "./figure-steps";
import { kindAppliesToDance } from "./vocabulary";

// Parse a WDSF syllabus timing string into one float beat-count per step.
//
// The WDSF Standard syllabus states each figure's timing as syllable counts
// (S=slow, Q=quick, digits, & = the off-beat "and"). This converts that string
// into the figure's per-step `count` positions — 1-indexed floats on the 1/8
// grid (timing.ts), the same model the attribute write schema validates.
//
// Walk left→right with a beat cursor at 1.0: each beat symbol places a step at
// the cursor, then advances it by the symbol's duration (S=2, Q=1, digit=1,
// &=0.5). An `&` SPLITS the preceding symbol — a symbol immediately followed by
// `&` advances only 0.5, the `&` taking the other half (so "Q&Q" → 1,1.5,2).
// A `-` EXTENDS the preceding symbol by one beat WITHOUT emitting a step — the
// WDSF technique books chart rows spanning 3+ beats (e.g. the Viennese Waltz
// Drag Hesitation drags through beats 3–5), which S/Q alone cannot express:
// "SS-Q" → steps on 1, 3 (held through 5), 6. Spaces are bar separators
// (cosmetic; the cursor already accumulates).
//
// Approximations (documented; the public syllabus lacks the rest, refinable
// later per Q-LIBSEED): a "(… Lady)" group is the follower's variant — stripped,
// leaving the base/leader timing; other parens are kept as optional steps; a
// leading `&` is clamped to the beat-1 floor the write schema enforces.

const DURATION: Record<string, number> = { S: 2, Q: 1, "&": 0.5 };

export function parseWdsfTiming(timing: string): number[] {
  // Drop follower-specific "(... Lady ...)" alternatives, keep the base timing.
  const base = timing.replace(/\([^()]*Lady[^()]*\)/gi, "");
  // Remaining parens denote optional steps — keep their contents, drop the parens.
  const tokens = [...base.replace(/[()]/g, "")].filter((ch) => /[SQ&1-9-]/.test(ch));

  const counts: number[] = [];
  let cursor = 1;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) continue;
    if (token === "-") {
      cursor += 1; // hold: the previous step lasts one beat longer, no new step
      continue;
    }
    counts.push(Math.round(cursor * 8) / 8); // snap to the 1/8 grid
    const next = tokens[i + 1];
    let dur = DURATION[token] ?? 1; // a digit is one beat
    if (next === "&") dur = 0.5; // the & steals the second half of this symbol
    cursor += dur;
  }
  return counts;
}

/**
 * Build a figure's per-step timeline attributes from its WDSF timing.
 *
 * When the figure has VERIFIED content (figure-steps.ts) whose step count matches the parsed
 * timing, emit the real per-count `direction` (headline) + `footwork` (foot part) for BOTH
 * roles — so the figure arrives with a full timeline. Otherwise fall back to the public-
 * syllabus scaffold: one free-text `footwork` attribute per count, carrying the `start` phrase
 * on the first step and `finish` on the last, blank between (detailed footwork lives in the
 * paid technique books — the content workstream fills it in via figure-steps.ts over time).
 *
 * Ids are deterministic so the generated catalog is stable.
 */
export function buildWdsfAttributes(input: {
  figureType: string;
  dance: DanceId;
  timing: string;
  start?: string;
  finish?: string;
}): Attribute[] {
  const counts = parseWdsfTiming(input.timing);

  const authored = authoredSteps(input.dance, input.figureType);
  if (authored && authored.length === counts.length) {
    const out: Attribute[] = [];
    counts.forEach((count, i) => {
      const step = authored[i];
      if (!step) return;
      // Per-role (role-aware) attributes: direction + footwork always, plus
      // sway / turn / bodyActions when the chart carries them.
      for (const role of ["leader", "follower"] as const) {
        const base = `fig-${input.figureType}-${input.dance}-${role}-s${i + 1}`;
        const f = step[role];
        out.push({
          id: `${base}-dir`,
          kind: "direction",
          count,
          role,
          value: f.direction,
          deletedAt: null,
        });
        out.push({
          id: `${base}-foot`,
          kind: "footwork",
          count,
          role,
          value: f.footwork,
          deletedAt: null,
        });
        if (f.sway)
          out.push({
            id: `${base}-sway`,
            kind: "sway",
            count,
            role,
            value: f.sway,
            deletedAt: null,
          });
        if (f.turn)
          out.push({
            id: `${base}-turn`,
            kind: "turn",
            count,
            role,
            value: f.turn,
            deletedAt: null,
          });
        for (const [j, ba] of (f.bodyActions ?? []).entries()) {
          out.push({
            id: `${base}-ba${j}`,
            kind: "bodyActions",
            count,
            role,
            value: ba,
            deletedAt: null,
          });
        }
        if (f.footPosition)
          out.push({
            id: `${base}-fpos`,
            kind: "footPosition",
            count,
            role,
            value: f.footPosition,
            deletedAt: null,
          });
      }
      // Shared (non-role) attributes: the couple's rise & position for this count.
      const shared = `fig-${input.figureType}-${input.dance}-s${i + 1}`;
      // Rise omits Tango (no rise & fall) — gate on the registry so a stray Tango
      // rise in a chart can never emit an attribute the write schema would reject.
      if (step.rise && kindAppliesToDance("rise", input.dance)) {
        out.push({
          id: `${shared}-rise`,
          kind: "rise",
          count,
          role: null,
          value: step.rise,
          deletedAt: null,
        });
      }
      if (step.position)
        out.push({
          id: `${shared}-pos`,
          kind: "position",
          count,
          role: null,
          value: step.position,
          deletedAt: null,
        });
    });
    return out;
  }

  const last = counts.length - 1;
  return counts.map((count, i) => ({
    id: `wdsf-${input.figureType}-${input.dance}-s${i + 1}`,
    kind: "footwork",
    count,
    role: null,
    value: i === 0 ? (input.start ?? "") : i === last ? (input.finish ?? "") : "",
    deletedAt: null,
  }));
}
