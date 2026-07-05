// Browser connectivity as a React external store (PLAN §11.2).
//
// `navigator.onLine` + the online/offline events — PLUS a slow poll, because
// not every environment fires the events when connectivity flips (Chromium's
// emulated/devtools offline changes `navigator.onLine` silently — the same
// under-signalling the DocConnection zombie-socket guard exists for). The poll
// only notifies on an actual change, so subscribers re-render at most once per
// flip. SSR/jsdom default to "online".
import { useSyncExternalStore } from "react";

const POLL_MS = 2000;

const isOnline = (): boolean => (typeof navigator === "undefined" ? true : navigator.onLine);

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  let last = isOnline();
  const timer = setInterval(() => {
    const now = isOnline();
    if (now !== last) {
      last = now;
      onChange();
    }
  }, POLL_MS);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
    clearInterval(timer);
  };
}

/** Reactive `navigator.onLine` — drives the §11.2 creation gates + OfflineBanner. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}
