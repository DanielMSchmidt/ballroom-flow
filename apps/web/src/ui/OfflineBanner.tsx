import { useSyncExternalStore } from "react";

// Browser connectivity as an external store — `navigator.onLine` + the
// online/offline events. SSR/jsdom default to "online".
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
const isOnline = (): boolean => (typeof navigator === "undefined" ? true : navigator.onLine);

/**
 * OfflineBanner — the app-shell offline state (US-050 AC-2): the PWA shell
 * loads from the service-worker cache with no network, and this banner says so
 * PLAINLY instead of letting screens fail quietly (stale lists, silent fetch
 * errors). An aria-live status so screen readers announce the transition; not
 * color-only (#5). Renders nothing while online.
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, isOnline, () => true);
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="flex items-center gap-2 rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-2xs font-semibold text-ink-secondary"
    >
      <span aria-hidden="true">⚠︎</span>
      You're offline — showing what's saved on this device. Changes sync when you're back online.
    </div>
  );
}
