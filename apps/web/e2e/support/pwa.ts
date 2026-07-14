import { expect, type Page, test } from "@playwright/test";

/**
 * Guard an offline-RELOAD journey against a Playwright/WebKit limitation.
 *
 * Playwright's WebKit build throws "WebKit encountered an internal error" on ANY
 * navigation while `context.setOffline(true)` — verified in CI for BOTH
 * `page.reload()` (Page.reload) and `page.goto()` (Page.navigate), at both `load`
 * and `commit` wait conditions. It is the *navigation-while-offline* that WebKit
 * can't emulate, not offline itself: the "access revoked while offline" journey,
 * which goes offline but never navigates, passes on WebKit. This is a test-harness
 * limitation of Playwright's patched WebKit, NOT a product bug — real Safari
 * reloads an installed PWA offline fine. So these journeys run on chromium-desktop
 * + mobile-chrome (both real engines in the matrix) and are skipped on WebKit.
 *
 * Call at the top of any test whose body performs {@link reloadOffline}.
 */
export function skipOfflineReloadOnWebkit(browserName: string): void {
  test.skip(
    browserName === "webkit",
    "Playwright/WebKit throws 'WebKit encountered an internal error' on any navigation while offline (page.reload + page.goto); offline-reload is covered on chromium-desktop + mobile-chrome",
  );
}

/**
 * Reload a page that is currently OFFLINE and served from the service-worker
 * precache. Only reached on non-WebKit engines (see
 * {@link skipOfflineReloadOnWebkit}); on those, a plain reload works. Callers
 * follow with web-first assertions that auto-wait for the real content.
 */
export async function reloadOffline(page: Page): Promise<void> {
  await page.reload();
  // A defensive nudge: web-first assertions in the caller do the real waiting,
  // but block here until the document has at least committed so a caller's first
  // query doesn't race an in-flight navigation.
  await expect(page.locator("body")).toBeVisible();
}
