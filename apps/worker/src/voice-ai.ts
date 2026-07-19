// AI voice notes — the mockable VoiceAi seam, the deterministic fixture, and the
// mandatory grounding (docs/concepts/annotations.md § The Journal, docs/system/
// architecture.md).
//
// The seam is what makes this feature testable with ZERO secrets: the Workers AI
// binding (`AI`) exists only in deployed wrangler envs, so dev, unit tests, and
// E2E all run `fixtureVoiceAi()` — a fully deterministic implementation derived
// from its inputs. The real Workers AI implementation arrives in Task 4 (behind
// `voiceAiFor`, gated on the binding being present AND not under the E2E harness).
//
// SECURITY: Workers AI JSON mode gives NO hard schema guarantee, so the model's
// output is UNTRUSTED. `groundProposal` re-validates it with the contract schema
// AND grounds every ref against the assembled context — any mismatch degrades to
// a resolved:false, transcript-only fallback. The /interpret route is read-only;
// nothing here writes D1, a DO, or the CRDT.

import {
  figureTypeAnchorLabel,
  type VoiceAnchor,
  type VoiceNoteProposal,
  type VoiceProposalOption,
  zVoiceExtraction,
} from "@weavesteps/contract";
import type { ChoreoContext, ChoreoContextFigure } from "@weavesteps/domain";

export interface VoiceAi {
  /** Whisper-fallback STT. `initialPrompt` is seeded with in-scope figure names. */
  transcribe(audio: Uint8Array, opts: { initialPrompt: string }): Promise<string>;
  /** Grounded extraction. Returns the model's RAW JSON — UNTRUSTED until Zod-parsed. */
  interpret(transcript: string, context: ChoreoContext): Promise<unknown>;
}

/** The resolved:false, transcript-only fallback — never a wrong anchor. */
function unresolved(transcript: string): VoiceNoteProposal {
  return {
    resolved: false,
    noteText: transcript,
    confidence: "low",
    proposed: null,
    alternatives: [],
  };
}

/** Every (choreo, figure) pair in scope — one entry per placement. */
function flatFigures(
  context: ChoreoContext,
): { choreoId: string; choreoName: string; dance: string; figure: ChoreoContextFigure }[] {
  return context.choreos.flatMap((choreo) =>
    choreo.figures.map((figure) => ({
      choreoId: choreo.id,
      choreoName: choreo.name,
      dance: choreo.dance,
      figure,
    })),
  );
}

/**
 * Decorate a grounded anchor into a display-ready proposal option: a figureType
 * (family) anchor carries no routineRef and gets the shared family label; a
 * figure/point anchor names its owning choreo and gets a "<name> · <choreo>"
 * label. Returns null when the anchor cannot be grounded against the context —
 * the caller degrades to resolved:false. PURE.
 */
function groundAnchor(anchor: VoiceAnchor, context: ChoreoContext): VoiceProposalOption | null {
  const flat = flatFigures(context);
  if (anchor.type === "figureType") {
    // A concrete danceScope must be a dance actually in scope; the figureType
    // must appear on at least one placed figure of that scope.
    if (anchor.danceScope !== "all" && !context.dances.some((d) => d.id === anchor.danceScope)) {
      return null;
    }
    const matches = flat.some(
      (f) =>
        f.figure.figureType === anchor.figureType &&
        (anchor.danceScope === "all" || f.dance === anchor.danceScope),
    );
    if (!matches) return null;
    return {
      anchor,
      routineRef: null,
      label: figureTypeAnchorLabel(anchor.figureType, anchor.danceScope, anchor.count),
    };
  }
  // figure / point: the figureRef must be a placed figure's ref.
  const owner = flat.find((f) => f.figure.figureRef === anchor.figureRef);
  if (!owner) return null;
  if (anchor.type === "point" && !owner.figure.counts.some((c) => c.count === anchor.count)) {
    return null; // a count the figure doesn't chart is not a real anchor
  }
  return {
    anchor,
    routineRef: owner.choreoId,
    label: `${owner.figure.name} · ${owner.choreoName}`,
  };
}

/**
 * The mandatory re-validation + grounding: Zod-parse the raw model output with
 * `zVoiceExtraction`, then ground every ref against the assembled context. Any
 * failure → the resolved:false, transcript-only fallback. On success, decorate
 * the anchor (and each groundable alternative) with its routing + label. PURE —
 * exported for direct testing. Never trusts the model's shape; never casts it.
 */
export function groundProposal(
  raw: unknown,
  context: ChoreoContext,
  transcript: string,
): VoiceNoteProposal {
  const parsed = zVoiceExtraction.safeParse(raw);
  if (!parsed.success) return unresolved(transcript);
  const extraction = parsed.data;
  if (!extraction.resolved || extraction.anchor == null) return unresolved(transcript);

  const proposed = groundAnchor(extraction.anchor, context);
  if (!proposed) return unresolved(transcript);

  const alternatives = extraction.alternatives
    .map((a) => groundAnchor(a, context))
    .filter((o): o is VoiceProposalOption => o !== null)
    .slice(0, 5);

  return {
    resolved: true,
    noteText: extraction.noteText,
    confidence: extraction.confidence,
    proposed,
    alternatives,
  };
}

// ── Deterministic fixture ────────────────────────────────────────────────────
// The fixture emits MODEL-SHAPED JSON (so the route's re-validation runs
// identically on fixture and real output) derived purely from its inputs — this
// is what lets the E2E scenarios be assertable without canned per-test responses.

/** Ordinal words the fixture recognizes → 1-based index. */
const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
};

/** Normalize for matching: lowercase, drop punctuation, collapse whitespace. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does the transcript mention this figure (by normalized name or figureType, tolerating plurals)? */
function transcriptMentionsFigure(lower: string, figure: ChoreoContextFigure): boolean {
  const candidates = [norm(figure.name), norm(figure.figureType)];
  return candidates.some((c) => {
    if (c === "") return false;
    return (
      lower.includes(c) ||
      lower.includes(`${c}s`) ||
      (c.endsWith("s") && lower.includes(c.slice(0, -1)))
    );
  });
}

/** Strip the leading "in <dance>, in <figure>, …" clauses so noteText is the note. */
function extractNoteText(transcript: string): string {
  // Drop everything up to and including the last comma in the first sentence —
  // the "In Slowfox, in Feather Steps," lead-in — falling back to the whole
  // transcript when there is no such lead-in.
  const firstSentence = transcript.split(/(?<=[.!?])\s/)[0] ?? transcript;
  const lastComma = firstSentence.lastIndexOf(",");
  if (lastComma === -1) return transcript.trim();
  const tail = transcript.slice(lastComma + 1).trim();
  return tail.length > 0 ? tail : transcript.trim();
}

/** The fixture's model-shaped extraction (matches zVoiceExtraction's shape). */
function fixtureInterpret(transcript: string, context: ChoreoContext): unknown {
  const lower = ` ${norm(transcript)} `;
  const words = lower.split(" ").filter(Boolean);
  const bigrams = words.map((w, i) => (i + 1 < words.length ? `${w} ${words[i + 1]}` : w));

  // Resolve a dance from any word/bigram via the alias table.
  const danceMention = [...bigrams, ...words].find((m) => {
    for (const d of context.dances) {
      if (m === d.id || m === norm(d.name) || d.aliases.some((a) => norm(a) === m)) return true;
    }
    return false;
  });
  const dance = danceMention
    ? (context.dances.find(
        (d) =>
          danceMention === d.id ||
          danceMention === norm(d.name) ||
          d.aliases.some((a) => norm(a) === danceMention),
      )?.id ?? null)
    : null;

  const noteText = extractNoteText(transcript);
  const flat = flatFigures(context);

  // Match a choreo by name substring, and an ordinal ("first"/"second").
  const matchedChoreo = context.choreos.find((ch) => lower.includes(norm(ch.name)));
  const ordinal = words.map((w) => ORDINALS[w]).find((n) => n != null);

  // An ordinal (or a matched choreo) → a `figure` anchor on the nth matching
  // placement, confined to the matched choreo when one is named.
  if (ordinal != null || matchedChoreo) {
    const scope = matchedChoreo ? flat.filter((f) => f.choreoId === matchedChoreo.id) : flat;
    const matching = scope.filter((f) => transcriptMentionsFigure(lower, f.figure));
    const pick = matching[(ordinal ?? 1) - 1] ?? matching[0];
    if (pick) {
      return {
        resolved: true,
        noteText,
        confidence: dance ? "high" : "medium",
        anchor: { type: "figure", figureRef: pick.figure.figureRef },
        alternatives: [],
      };
    }
  }

  // Otherwise a matched figure → an untimed figureType anchor (the resolved dance,
  // or "all" when no dance matched).
  const figureMatch = flat.find((f) => transcriptMentionsFigure(lower, f.figure));
  if (figureMatch) {
    return {
      resolved: true,
      noteText,
      confidence: dance ? "high" : "medium",
      anchor: {
        type: "figureType",
        figureType: figureMatch.figure.figureType,
        danceScope: dance ?? "all",
      },
      alternatives: [],
    };
  }

  // No figure match → unresolved (the model saw no groundable anchor).
  return { resolved: false, noteText, confidence: "low", anchor: null, alternatives: [] };
}

/** Deterministic fixture (unit tests, E2E, local dev — zero secrets, zero flake). */
export function fixtureVoiceAi(): VoiceAi {
  return {
    async transcribe(audio) {
      return new TextDecoder().decode(audio);
    },
    async interpret(transcript, context) {
      return fixtureInterpret(transcript, context);
    },
  };
}

/**
 * Select the VoiceAi implementation. Until the Workers AI binding lands (Task 4),
 * this returns the fixture UNCONDITIONALLY and honestly — `Env` carries no `AI`
 * yet, so there is no real seam to select. Task 4 turns this into
 * `env.AI && env.E2E_TEST_ROUTES !== "1" ? workersVoiceAi(...) : fixtureVoiceAi()`
 * so dev/tests/e2e keep running the fixture (zero secrets), structurally.
 */
export function voiceAiFor(_env: unknown): VoiceAi {
  return fixtureVoiceAi();
}
