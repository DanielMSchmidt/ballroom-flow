// Reading-view column PICKS (Builder v3 — supersedes the 1.23 hide/show
// filter). The reader picks UP TO 4 technique columns to lay side-by-side;
// every figure in the routine renders exactly those columns (a figure without
// the kind shows empty dots), and the notes margin owns the right edge. Rules:
// picking a 5th column drops the OLDEST pick; the last remaining column can't
// be removed (min 1); picks are remembered PER DEVICE, ACROSS choreos —
// exactly like the Leader/Follower lens (`bb_role`).
import { useCallback, useState } from "react";
import type { ReadingColumn } from "./reading-columns";

/** The persisted picked-column ids, in pick order (per device, across
 *  choreos). Mirrors the design prototype's `readShown` state. */
const STORAGE_KEY = "bb_read_columns";

/** The design's default picks (Builder v3): Step · Rise · Turn · Pos. */
export const DEFAULT_READ_COLUMNS = ["step", "rise", "turn", "position"];

/** The most columns the reading table lays side-by-side (Builder v3). */
export const MAX_READ_COLUMNS = 4;

function readStored(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READ_COLUMNS;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const ids = parsed.filter((k): k is string => typeof k === "string");
      if (ids.length > 0) return ids;
    }
    return DEFAULT_READ_COLUMNS;
  } catch {
    return DEFAULT_READ_COLUMNS;
  }
}

function writeStored(picked: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(picked));
  } catch {
    // Best-effort — the in-memory picks still apply this session.
  }
}

/** A `[pickedColumnIds, toggle]` pair persisted to localStorage. Toggling an
 *  unpicked id appends it (dropping the oldest pick past MAX_READ_COLUMNS);
 *  toggling a picked id removes it unless it's the only pick left. */
export function useStoredReadColumns(): [string[], (columnId: string) => void] {
  const [picked, setPicked] = useState<string[]>(readStored);
  const toggle = useCallback((columnId: string) => {
    setPicked((prev) => {
      const next = prev.slice();
      const i = next.indexOf(columnId);
      if (i >= 0) {
        if (next.length <= 1) return prev;
        next.splice(i, 1);
      } else {
        next.push(columnId);
        if (next.length > MAX_READ_COLUMNS) next.shift();
      }
      writeStored(next);
      return next;
    });
  }, []);
  return [picked, toggle];
}

/**
 * The columns every figure should RENDER: the picks that exist among the
 * routine's used columns, in pick order — falling back to the first up-to-3
 * used columns when no pick applies (so a routine of only custom kinds still
 * reads). Never empty while the routine uses any kind.
 */
export function shownReadColumns(picked: string[], used: ReadingColumn[]): ReadingColumn[] {
  const byId = new Map(used.map((c) => [c.id, c]));
  const shown = picked.flatMap((id) => {
    const col = byId.get(id);
    return col ? [col] : [];
  });
  if (shown.length > 0) return shown;
  return used.slice(0, 3);
}
