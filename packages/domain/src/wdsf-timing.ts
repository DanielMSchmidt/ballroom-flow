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
// Spaces are bar separators (cosmetic; the cursor already accumulates).
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
  const tokens = [...base.replace(/[()]/g, "")].filter((ch) => /[SQ&1-9]/.test(ch));

  const counts: number[] = [];
  let cursor = 1;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) continue;
    counts.push(Math.round(cursor * 8) / 8); // snap to the 1/8 grid
    const next = tokens[i + 1];
    let dur = DURATION[token] ?? 1; // a digit is one beat
    if (next === "&") dur = 0.5; // the & steals the second half of this symbol
    cursor += dur;
  }
  return counts;
}
