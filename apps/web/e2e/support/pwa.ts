import type { Page } from "@playwright/test";

/**
 * Reload a page that is currently OFFLINE and served from the service-worker
 * precache.
 *
 * WebKit (mobile-safari project) throws "WebKit encountered an internal error"
 * from `page.reload()` on an offline, SW-served navigation — and it does so at the
 * reload command itself, not the wait condition (switching `waitUntil` from `load`
 * to `commit` did not help; the error just moved to "waiting until commit"). The
 * `Page.reload` CDP path is what WebKit chokes on offline. Re-navigating to the
 * SAME URL uses the `Page.navigate` path instead, which WebKit services from the
 * SW cache without the internal error — an equivalent reload for these journeys.
 * We wait only for COMMIT; every caller then uses web-first assertions
 * (`toBeVisible`, `toContainText`) that auto-wait for the actual content, so no
 * coverage is lost. Chromium/mobile-chrome take this same path with no change in
 * behaviour (verified locally).
 */
export async function reloadOffline(page: Page): Promise<void> {
  await page.goto(page.url(), { waitUntil: "commit" });
}
