import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";

// ─────────────────────────────────────────────────────────────────────────
// PWA install/offline shell + accessibility/cross-browser (PLAN §10.2 E2E:
// "PWA install/app-shell-offline; nav"). Covers:
//   US-050 — installable PWA; shell loads offline with a clear "you're offline";
//   US-051 — keyboard/SR/reduced-motion + ≥44px (real-browser a11y);
//   US-052 — runs across chromium-desktop / mobile-chrome / mobile-safari (the
//            3 configured projects) — the matrix itself is the coverage.
//
// @smoke includes the install-manifest + offline-shell checks.
// ─────────────────────────────────────────────────────────────────────────

/** Wait until the service worker is ACTIVE and CONTROLLING the page — `ready`
 *  alone resolves on activation, before the controller claims this client. */
async function serviceWorkerControls(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
}

test.describe("@smoke PWA install + offline app shell", () => {
  test("registers a service worker and exposes an installable manifest", async ({ page }) => {
    // Intent: the app is installable (manifest + icons + service worker) —
    // US-050 AC-1. Steps/asserts: load the app; the web manifest link is
    // present and its manifest carries a name + real icons (an empty `icons`
    // array is NOT installable); the service worker registers and takes control.
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    // Annotated (not asserted): the in-page fetch hands back untyped JSON.
    const manifest: { name?: string; icons?: unknown[] } = await page.evaluate(async () => {
      const href = document.querySelector('link[rel="manifest"]')?.getAttribute("href");
      if (!href) throw new Error("no manifest link");
      return (await fetch(href)).json();
    });
    expect(manifest.name).toBe("Weave Steps");
    expect((manifest.icons ?? []).length).toBeGreaterThanOrEqual(2);
    await serviceWorkerControls(page);
  });

  test("loads the app shell offline with a clear 'you're offline' state", async ({
    page,
    context,
  }) => {
    // Intent: online-first — the shell loads offline; the UI shows an explicit
    // offline state instead of failing quietly (US-050 AC-2).
    // Steps/asserts:
    //   1. Load once online (prime the SW precache) and wait for control.
    //   2. Go offline (context.setOffline) and reload → the app SHELL still
    //      renders from the SW cache.
    //   3. The OfflineBanner announces "you're offline" for data.
    await seedAuth(page, "user_solo");
    await page.goto("/");
    await serviceWorkerControls(page);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await expect(page.getByTestId("offline-banner")).toHaveText(/offline/i);
    await context.setOffline(false);
  });
});

test.describe("accessibility: keyboard navigation + targets (real browser)", () => {
  test("the primary nav is keyboard reachable, focus is visible, targets are ≥44px", async ({
    page,
  }) => {
    // Intent: keyboard + SR navigability; focus-visible; ≥44px targets
    // (US-051 AC-2). Steps/asserts: seedAuth; load; Tab lands a visible focus;
    // every visible nav target is at least 44px tall (--bf-touch-target).
    await seedAuth(page, "user_solo");
    await page.goto("/");
    await expect(page.getByRole("navigation").locator("button").first()).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();

    const targets = page.locator("nav button:visible");
    const count = await targets.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await targets.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("honors prefers-reduced-motion (motion tokens collapse to 0ms)", async ({ page }) => {
    // Intent: reduced-motion is respected (US-051): every transition/animation
    // rides the --bf-motion-* tokens, which the tokens.css media rule zeroes.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedAuth(page, "user_solo");
    await page.goto("/");
    await expect(page).toHaveTitle(/ballroom/i);
    const fast = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bf-motion-fast").trim(),
    );
    // Chromium serializes the computed 0ms as "0s" — accept either zero form.
    expect(fast).toMatch(/^0m?s$/);
  });
});
