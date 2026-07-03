// Reading-view column filter (design 1.23 — "type chips", the chosen direction
// of the 1d "too crowded" exploration, 2026-07-03). The chips row over the
// reading programme hides/shows a technique COLUMN across every figure. Rules
// (design 1d "shared rules"): hiding never touches data (grey stays "empty /
// off", never data); Step* is required and never hideable; custom kinds are
// first-class in the filter; the choice is remembered PER DEVICE, ACROSS
// choreos — exactly like the Leader/Follower lens (`bb_role`).
import { useCallback, useState } from "react";
import type { ReadingColumn } from "./reading-columns";

/** The persisted hidden-column ids (per device, across choreos). The key —
 *  `bb_hidden_types` — mirrors the design prototype's storage. */
const STORAGE_KEY = "bb_hidden_types";

/** One-time "some columns are tucked away" hint flag (design 1.26: the backup
 *  for tour skippers). Also stamped when the user hides a column themselves —
 *  they plainly know the feature, so the hint would only nag. */
const HINT_KEY = "bb_hidden_types_hint";

/** The Step column can never be hidden (design: "Step* is required"). */
export function isLockedColumn(col: ReadingColumn): boolean {
  return col.isStep === true;
}

function readStored(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    // Accept both shapes: our array, and the prototype's `{ kind: 1 }` map.
    if (Array.isArray(parsed)) return new Set(parsed.filter((k) => typeof k === "string"));
    if (parsed && typeof parsed === "object") return new Set(Object.keys(parsed));
    return new Set();
  } catch {
    return new Set();
  }
}

function writeStored(hidden: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...hidden]));
  } catch {
    // Best-effort — the in-memory choice still applies this session.
  }
}

/** A `[hiddenColumnIds, toggle]` pair persisted to localStorage. `toggle`
 *  ignores the locked Step column (callers surface the "always shown" toast). */
export function useStoredHiddenColumns(): [ReadonlySet<string>, (columnId: string) => void] {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(readStored);
  const toggle = useCallback((columnId: string) => {
    if (columnId === "step") return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      writeStored(next);
      return next;
    });
  }, []);
  return [hidden, toggle];
}

/** The columns a figure should RENDER: everything while peeked, otherwise the
 *  used columns minus the hidden ones (Step always survives). */
export function visibleColumns(
  columns: ReadingColumn[],
  hidden: ReadonlySet<string>,
  peeked: boolean,
): ReadingColumn[] {
  if (peeked) return columns;
  return columns.filter((c) => isLockedColumn(c) || !hidden.has(c.id));
}

/** How many of a figure's used columns the filter currently hides — the
 *  figure's "+N hidden" peek pill count (0 = no pill). */
export function hiddenColumnCount(columns: ReadingColumn[], hidden: ReadonlySet<string>): number {
  return columns.filter((c) => !isLockedColumn(c) && hidden.has(c.id)).length;
}

/** Has the one-time "columns are tucked away" hint already shown? Storage
 *  failures read as "seen" so the hint can never nag on every visit (same
 *  posture as the tour seen-flags). */
export function hasSeenHiddenHint(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) != null;
  } catch {
    return true;
  }
}

export function markHiddenHintSeen(): void {
  try {
    window.localStorage.setItem(HINT_KEY, "done");
  } catch {
    // Best-effort — the gate above already reads "seen".
  }
}
