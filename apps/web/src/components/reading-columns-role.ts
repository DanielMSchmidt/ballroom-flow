// Persisted role lens (frame 1.6 "STEPS FOR" / WEP-0005 edit lens). The choice
// is remembered across routines + reloads via localStorage (key `bb_role`), so
// re-opening a routine keeps the dancer's chosen side. The stored value may be
// the edit-only "both" (WEP-0005) — read surfaces coerce it via `asReadView`.
// Falls back to "leader" when storage is unavailable (SSR / private mode /
// tests).
import { useCallback, useState } from "react";
import type { EditRoleView } from "./role-view";

const STORAGE_KEY = "bb_role";

function readStored(): EditRoleView {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "follower" || v === "both" ? v : "leader";
  } catch {
    return "leader";
  }
}

/** A `[roleView, setRoleView]` pair that persists the choice to localStorage. */
export function useStoredRoleView(): [EditRoleView, (next: EditRoleView) => void] {
  const [view, setView] = useState<EditRoleView>(readStored);
  const set = useCallback((next: EditRoleView) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort — the in-memory choice still applies.
    }
  }, []);
  return [view, set];
}
