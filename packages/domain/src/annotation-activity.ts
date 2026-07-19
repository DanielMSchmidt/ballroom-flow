// Comment activity fade-out (docs/concepts/annotations.md § Where notes appear):
// the reading view renders ACTIVE comments by default and collapses the rest
// behind a counted expander. A comment is active when its thread saw activity
// within the last 28 days, OR within 7 days of the newest activity in its
// rendered list (a session-gap window — guarantees a quiet routine's last
// conversation never goes dark). PURE and wall-clock-free: `now` is always
// injected (the app's first wall-clock-dependent rendering; tests inject it).
// Rolling ms durations against stored unix-ms timestamps — never calendar
// days, so the set is timezone-independent and doesn't flip at midnight.

/** 28 days in ms — the absolute recency window. */
export const ACTIVE_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;
/** 7 days in ms — the session-gap window, relative to the list's newest activity. */
export const SESSION_GAP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The structural shape the partition needs — Annotation satisfies it, and so
 * does any comment-like object carrying a unix-ms `createdAt` (replies optional).
 */
export type ActivitySource = {
  createdAt: number;
  replies?: readonly { createdAt: number; deletedAt?: number | null }[];
};

/** A thread's latest activity: max of its own createdAt and its LIVE replies'.
 *  Tombstoned replies never count — a deleted reply is not activity. */
export function lastActivity(c: ActivitySource): number {
  let latest = c.createdAt;
  for (const r of c.replies ?? []) {
    if (r.deletedAt == null && r.createdAt > latest) latest = r.createdAt;
  }
  return latest;
}

/**
 * Partition a rendered per-anchor comment list into { active, stale }, order
 * preserved within each side. Both windows are INCLUSIVE (≥); the relative
 * window includes its own anchor, so a non-empty list always has a non-empty
 * active set (never-empty guarantee — an all-stale non-empty cell cannot occur).
 */
export function partitionByActivity<T extends ActivitySource>(
  list: readonly T[],
  now: number,
): { active: T[]; stale: T[] } {
  if (list.length === 0) return { active: [], stale: [] };
  let anchor = Number.NEGATIVE_INFINITY;
  for (const c of list) anchor = Math.max(anchor, lastActivity(c));
  const active: T[] = [];
  const stale: T[] = [];
  for (const c of list) {
    const a = lastActivity(c);
    if (a >= now - ACTIVE_WINDOW_MS || a >= anchor - SESSION_GAP_WINDOW_MS) active.push(c);
    else stale.push(c);
  }
  return { active, stale };
}
