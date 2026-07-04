// US-002 — Dance metadata registry (PLAN §3, §10.2).
//
// One source of truth for the 5 Standard *travelling* dances of v1. Timing,
// phrasing, and applicability rules (e.g. float-count timing in US-004, the
// Tango-omits-rise rule in US-003) all derive from this registry — never from
// scattered literals. Latin/spot dances are out of scope for v1 (§3) and
// deliberately absent.
//
// Constants per §3: beatsPerBar is 3 for the 3/4 swing waltzes and 4 for the
// rest; phraseBeats (the counted phrase a float-count wraps in) is 6 and 8
// respectively. Time signatures follow ballroom convention (research/domain.md):
// Waltz & Viennese 3/4, Foxtrot & Quickstep 4/4, Tango 2/4.

/** The 5 Standard travelling dances of v1 (no Latin/spot), as a runtime tuple —
 *  the single source for both the {@link DanceId} type and value-level checks
 *  (e.g. a Zod enum in @weavesteps/contract, US-025/#79). */
export const DANCE_IDS = ["waltz", "viennese_waltz", "quickstep", "foxtrot", "tango"] as const;

/** The 5 Standard travelling dances of v1 (no Latin/spot). */
export type DanceId = (typeof DANCE_IDS)[number];

/** Per-dance metadata driving timing, phrasing, and applicability. */
export interface DanceMeta {
  /** Musical time signature, e.g. "3/4" (display + reference). */
  timeSignature: string;
  /** Beats per bar: 3 for the waltzes, 4 for the rest. */
  beatsPerBar: number;
  /** Beats in the counted phrase a float-count wraps within: 6 (waltzes) / 8. */
  phraseBeats: number;
  /** All v1 dances travel along the line of dance. */
  travelling: boolean;
}

/** The single dance registry. Keyed by {@link DanceId}. */
export const DANCES: Record<DanceId, DanceMeta> = {
  waltz: { timeSignature: "3/4", beatsPerBar: 3, phraseBeats: 6, travelling: true },
  viennese_waltz: { timeSignature: "3/4", beatsPerBar: 3, phraseBeats: 6, travelling: true },
  quickstep: { timeSignature: "4/4", beatsPerBar: 4, phraseBeats: 8, travelling: true },
  foxtrot: { timeSignature: "4/4", beatsPerBar: 4, phraseBeats: 8, travelling: true },
  tango: { timeSignature: "2/4", beatsPerBar: 4, phraseBeats: 8, travelling: true },
};
