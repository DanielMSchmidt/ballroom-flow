// Context-first note capture (docs/concepts/annotations.md § The Journal note flow
// is scope-first). The CHOREO the dancer last scoped a Journal note to is
// remembered per-device via localStorage (key `bb_journal_choreo`), exactly like
// the reading lens prefs (reading-columns-role.ts). Only the routine docRef is
// stored; the editor resolves it against the loaded routine options, so a stale
// ref (deleted/unshared choreo) simply falls back to null ("all my dancing" —
// the old broad behavior), as does unavailable/unset storage.
import { useCallback, useState } from "react";

const STORAGE_KEY = "bb_journal_choreo";

function readStored(): string | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v != null && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** A `[choreoRef, setChoreoRef]` pair that persists the chosen scope choreo's
 *  docRef (or null = "all my dancing") to localStorage. */
export function useStoredJournalChoreo(): [string | null, (next: string | null) => void] {
  const [ref, setRef] = useState<string | null>(readStored);
  const set = useCallback((next: string | null) => {
    setRef(next);
    try {
      if (next == null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort — the in-memory choice still applies.
    }
  }, []);
  return [ref, set];
}
