// Context-first note capture (docs/concepts/annotations.md § The Journal note flow
// is scope-first). The dance the dancer last scoped a Journal note to is
// remembered per-device via localStorage (key `bb_journal_dance`), exactly like
// the reading lens prefs (reading-columns-role.ts). Falls back to null ("all my
// dancing" — the old broad behavior) when storage is unavailable or unset.
import { type DanceId, isDanceId } from "@weavesteps/domain";
import { useCallback, useState } from "react";

const STORAGE_KEY = "bb_journal_dance";

function readStored(): DanceId | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v != null && isDanceId(v) ? v : null;
  } catch {
    return null;
  }
}

/** A `[dance, setDance]` pair that persists the chosen scope dance (or null =
 *  "all my dancing") to localStorage. */
export function useStoredJournalDance(): [DanceId | null, (next: DanceId | null) => void] {
  const [dance, setDance] = useState<DanceId | null>(readStored);
  const set = useCallback((next: DanceId | null) => {
    setDance(next);
    try {
      if (next == null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort — the in-memory choice still applies.
    }
  }, []);
  return [dance, set];
}
