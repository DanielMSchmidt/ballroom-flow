// store/ seam — offline-editing helpers (PLAN §11.2).
import { useEffect, useState } from "react";
import { defaultDocStorage } from "./doc-storage";

/**
 * How many §11.2 pending (not-yet-delivered) local changes this DEVICE holds
 * for `docRef`, read from the local persistence layer — usable by screens that
 * do NOT own a live store (e.g. ChoreoFlow's access-denied branch, which must
 * not hide unsyncable offline edits behind a denial screen — Q-NEW-2).
 *
 * Re-reads whenever `refreshKey` changes (pass e.g. the access state so a flip
 * to "denied" re-probes). 0 wherever persistence is unavailable (jsdom, private
 * browsing) — exactly the pre-§11.2 behavior.
 */
export function usePendingLocalChanges(docRef: string, refreshKey?: unknown): number {
  const [count, setCount] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshKey` is deliberately extra — it exists solely to re-run the probe (the persisted count changes without any reactive input changing).
  useEffect(() => {
    if (!docRef) return;
    const storage = defaultDocStorage();
    if (!storage) return;
    let cancelled = false;
    void storage.load(docRef).then(
      (persisted) => {
        if (!cancelled) setCount(persisted?.pendingCount ?? 0);
      },
      () => {
        // Unreadable storage — keep 0 (best-effort, never blocks the screen).
      },
    );
    return () => {
      cancelled = true;
    };
  }, [docRef, refreshKey]);
  return count;
}
