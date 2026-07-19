import { useMessages } from "../i18n";
import { uiMessages } from "../i18n/messages/ui";
// Shared connectivity store (events + a poll safety net, §11.2) — the same
// signal that disables the creation affordances, so banner and gates agree.
import { useOnline } from "../lib/use-online";

/**
 * OfflineBanner — the app-shell offline state (US-050 AC-2): the PWA shell
 * loads from the service-worker cache with no network, and this banner says so
 * PLAINLY instead of letting screens fail quietly (stale lists, silent fetch
 * errors). An aria-live status so screen readers announce the transition; not
 * color-only (#5). Renders nothing while online.
 */
export function OfflineBanner() {
  const t = useMessages(uiMessages);
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="flex items-center gap-2 rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-2xs font-semibold text-ink-secondary"
    >
      <span aria-hidden="true">⚠︎</span>
      {t.offlineBanner}
    </div>
  );
}
