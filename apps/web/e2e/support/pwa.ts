import type { Page } from "@playwright/test";

/**
 * Reload a page that is currently OFFLINE and served from the service-worker
 * precache.
 *
 * WebKit (mobile-safari project) throws "WebKit encountered an internal error"
 * when Playwright's default `page.reload()` waits for the `"load"` event on an
 * offline, SW-served navigation — offline, WebKit never fires a reliable `load`,
 * so the wait surfaces the browser's internal navigation error and the test
 * flakes (it failed on both the first attempt and the retry in CI, chromium
 * passed). Waiting only for the navigation to COMMIT sidesteps that: the document
 * is served from cache and committed, and every caller immediately follows with
 * web-first assertions (`toBeVisible`, `toContainText`) that auto-wait for the
 * actual content — so no coverage is lost, only the brittle `load`-event wait.
 */
export async function reloadOffline(page: Page): Promise<void> {
  await page.reload({ waitUntil: "commit" });
}
