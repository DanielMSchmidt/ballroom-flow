// Persisted Leader/Follower lens for the reading view (frame 1.6 "STEPS FOR").
// The choice is remembered across routines + reloads via localStorage (key
// `bb_role`), so re-opening a routine keeps the dancer's chosen side. Falls back
// to "leader" when storage is unavailable (SSR / private mode / tests).
import { useCallback, useState } from "react";
import type { RoleView } from "./role-view";

const STORAGE_KEY = "bb_role";

function readStored(): RoleView {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "follower" ? "follower" : "leader";
  } catch {
    return "leader";
  }
}

/** A `[roleView, setRoleView]` pair that persists the choice to localStorage. */
export function useStoredRoleView(): [RoleView, (next: RoleView) => void] {
  const [view, setView] = useState<RoleView>(readStored);
  const set = useCallback((next: RoleView) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort — the in-memory choice still applies.
    }
  }, []);
  return [view, set];
}
