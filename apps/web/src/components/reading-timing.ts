// Persisted Counts / Slow-Quick timing lens for the reading (timeline) view.
//
// Tango, Foxtrot and Quickstep dancers commonly read a figure's rhythm as SLOW
// and QUICK syllables (S/Q) rather than bare beat numbers (1 2 & 3). This lens
// flips the reading view's beat tokens between the two. The choice is remembered
// per device + across choreos via localStorage (key `bb_timing`), exactly like
// the Leader/Follower lens (`bb_role`). Falls back to "counts" when storage is
// unavailable (SSR / private mode / tests).

import type { DanceId } from "@weavesteps/domain";
import { useCallback, useState } from "react";

/** The reading view's timing notation: numeric counts, or slow/quick syllables. */
export type TimingView = "counts" | "slowquick";

/** The dances whose figures are conventionally counted in slows & quicks — the
 *  only dances the S/Q lens is offered for (the swing/rise dances use plain
 *  counts). Waltz/Viennese are 3/4 count dances and never S/Q. */
const SLOW_QUICK_DANCES: ReadonlySet<DanceId> = new Set<DanceId>(["tango", "foxtrot", "quickstep"]);

/** True when the dance uses slow/quick notation (Tango, Foxtrot, Quickstep). */
export function supportsSlowQuick(dance: DanceId): boolean {
  return SLOW_QUICK_DANCES.has(dance);
}

const STORAGE_KEY = "bb_timing";

function readStored(): TimingView {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "slowquick" ? "slowquick" : "counts";
  } catch {
    return "counts";
  }
}

/** A `[timingView, setTimingView]` pair that persists the choice to localStorage. */
export function useStoredTimingView(): [TimingView, (next: TimingView) => void] {
  const [view, setView] = useState<TimingView>(readStored);
  const set = useCallback((next: TimingView) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort — the in-memory choice still applies.
    }
  }, []);
  return [view, set];
}
