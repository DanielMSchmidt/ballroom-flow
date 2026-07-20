// AI voice notes — the choreo-context serializer + dance aliases
// (docs/concepts/annotations.md § The Journal, docs/system/architecture.md).
//
// PURE, I/O-free grounding data for the voice-note extraction model: given the
// choreography in scope, produce the exact figures (in placement order, one
// entry per placement so "the first bounce fallaway" grounds), each with its
// resolved count/attribute timeline, plus the in-scope dances and their spoken
// aliases. The worker sends this to the model as closed multiple-choice and
// re-validates every ref the model returns against it (never trust the model's
// shape — see apps/worker/src/voice-ai.ts groundProposal).
//
// This module consumes only pure siblings (./doc-types, ./dances, ./fork,
// ./order) — no Automerge, no Date.now, no randomness — so the same in-scope
// choreography always yields byte-identical grounding.
import { DANCE_IDS, type DanceId } from "./dances";
import type { Attribute, FigureDoc, Role, RoutineDoc } from "./doc-types";
import { resolveFigure } from "./fork";
import { sortByOrder } from "./order";

/** One count of a figure with its live (tombstone-dropped) attributes. */
export interface ChoreoContextCount {
  count: number;
  attributes: { kind: string; value: unknown; role: Role }[];
}

/** One placement's figure, resolved (variants folded against their live base). */
export interface ChoreoContextFigure {
  /** The placed figure doc's ref (a `figure` anchor names exactly this). */
  figureRef: string;
  figureType: string;
  name: string;
  sortKey?: string;
  counts: ChoreoContextCount[];
}

export interface ChoreoContextChoreo {
  id: string;
  name: string;
  dance: DanceId;
  figures: ChoreoContextFigure[];
}

export interface ChoreoContext {
  /** Only the dances actually present in scope, each with its spoken aliases. */
  dances: { id: DanceId; name: string; aliases: string[] }[];
  choreos: ChoreoContextChoreo[];
}

/**
 * Canonical English display names for the model prompt (NOT user-facing UI —
 * that stays localized in apps/web/src/i18n/vocabulary.ts). Kept here so the
 * serializer is pure and self-contained.
 */
const DANCE_DISPLAY_NAMES: Record<DanceId, string> = {
  waltz: "Waltz",
  viennese_waltz: "Viennese Waltz",
  quickstep: "Quickstep",
  foxtrot: "Foxtrot",
  tango: "Tango",
};

/**
 * Spoken/colloquial names per dance. NEW DATA — nothing like this existed; it
 * is common-ballroom-usage vocabulary (not sourced figure/seed data, so the
 * figure-data pipeline rules don't apply), deliberately kept to the safe floor:
 * only aliases in unambiguous everyday competitive use, never invented obscure
 * ones. "slowfox"/"slow fox" for Foxtrot and "Viennese" for Viennese Waltz are
 * the load-bearing ones (scenario A/B say "slowfox").
 */
export const DANCE_ALIASES: Record<DanceId, readonly string[]> = {
  waltz: ["english waltz", "slow waltz"],
  viennese_waltz: ["viennese"],
  foxtrot: ["slowfox", "slow foxtrot", "slow fox"],
  quickstep: [],
  tango: [],
};

/**
 * Resolve a spoken dance mention to a DanceId — case-insensitive, matching the
 * id, the English display name, or a spoken alias. Returns null when nothing
 * matches (the caller degrades to a dance-less / "all"-scoped resolution).
 */
export function resolveDanceAlias(mention: string): DanceId | null {
  const needle = mention.trim().toLowerCase();
  if (needle === "") return null;
  for (const id of DANCE_IDS) {
    if (needle === id) return id;
    if (needle === DANCE_DISPLAY_NAMES[id].toLowerCase()) return id;
    if (DANCE_ALIASES[id].some((alias) => alias.toLowerCase() === needle)) return id;
  }
  return null;
}

/** Live attributes of a figure at one integer beat, in kind order. */
function countAttributes(attributes: Attribute[], count: number): ChoreoContextCount["attributes"] {
  return attributes
    .filter((a) => a.deletedAt == null && a.count === count)
    .map((a) => ({ kind: a.kind, value: a.value, role: a.role ?? null }));
}

/** Group a figure's live attributes into ascending per-count entries. */
function toCounts(attributes: Attribute[]): ChoreoContextCount[] {
  const live = attributes.filter((a) => a.deletedAt == null);
  const counts = [...new Set(live.map((a) => a.count))].sort((x, y) => x - y);
  return counts.map((count) => ({ count, attributes: countAttributes(live, count) }));
}

/** Resolve a placed figure doc (fold a variant against its live base if given). */
function resolvePlacedFigure(figure: FigureDoc, base: FigureDoc | undefined): FigureDoc {
  if (figure.baseFigureRef != null && base != null) {
    return resolveFigure(base, figure);
  }
  return figure;
}

/**
 * Serialize in-scope choreography the way the reading view models it:
 * tombstones dropped, sections + placements in sortKey order, one figures[]
 * entry PER placement (ordinals need position; a figure placed twice appears
 * twice), each figure's timeline resolved against its live base. PURE.
 */
export function serializeChoreoContext(
  routines: {
    routine: RoutineDoc;
    figures: Record<string, FigureDoc>;
    bases?: Record<string, FigureDoc>;
  }[],
): ChoreoContext {
  const presentDances = new Set<DanceId>();
  const choreos: ChoreoContextChoreo[] = routines
    .filter((entry) => entry.routine.deletedAt == null)
    .map(({ routine, figures, bases }) => {
      const contextFigures: ChoreoContextFigure[] = [];
      const liveSections = sortByOrder(routine.sections.filter((s) => s.deletedAt == null));
      for (const section of liveSections) {
        const livePlacements = sortByOrder(section.placements.filter((p) => p.deletedAt == null));
        for (const placement of livePlacements) {
          if (placement.source === "break" || placement.figureRef == null) continue;
          const figure = figures[placement.figureRef];
          if (figure == null || figure.deletedAt != null) continue;
          const resolved = resolvePlacedFigure(figure, bases?.[placement.figureRef]);
          contextFigures.push({
            figureRef: figure.id,
            figureType: resolved.figureType,
            name: resolved.name,
            ...(placement.sortKey != null ? { sortKey: placement.sortKey } : {}),
            counts: toCounts(resolved.attributes),
          });
        }
      }
      presentDances.add(routine.dance);
      return { id: routine.id, name: routine.title, dance: routine.dance, figures: contextFigures };
    });

  const dances = DANCE_IDS.filter((id) => presentDances.has(id)).map((id) => ({
    id,
    name: DANCE_DISPLAY_NAMES[id],
    aliases: [...DANCE_ALIASES[id]],
  }));

  return { dances, choreos };
}
