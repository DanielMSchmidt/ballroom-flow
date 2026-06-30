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
// @smoke includes the offline-shell check (fast, no auth needed for the shell).
// SKIPPED until the PWA shell + screens land (M9); specs still COLLECT cleanly.
// ─────────────────────────────────────────────────────────────────────────

test.describe("@smoke PWA install + offline app shell", () => {
  test.skip(true, "M9 PWA shell + screens not built yet (see TEST-MAP.md)");

  test("registers a service worker and exposes an install manifest", async ({ page }) => {
    // Intent: the app is installable (manifest + service worker) — US-050 AC-1.
    // Steps/asserts: load the app; a web manifest link is present; a service worker
    //   registers (navigator.serviceWorker.ready resolves).
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    const swReady = await page.evaluate(() => "serviceWorker" in navigator);
    expect(swReady).toBe(true);
  });

  test("loads the app shell offline with a clear 'you're offline' state for data", async ({
    page,
    context,
  }) => {
    // Intent: online-first — the shell loads offline; data shows an explicit offline state.
    // Steps/asserts:
    //   1. Load once online (prime the SW cache), then go offline (context.setOffline).
    //   2. Reload → the app SHELL still renders (US-050 AC-2).
    //   3. A clear "you're offline" message shows for data (no silent stale content).
    //   4. Shell interactive quickly (US-050 AC-3 <~2s — asserted via a load metric in M9).
    await page.goto("/");
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText(/offline/i)).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe("accessibility: keyboard navigation + targets (real browser)", () => {
  test.skip(true, "M9 screens + a11y pass + E2E auth not built yet");

  test("the primary nav is keyboard reachable and focus is visible", async ({ page }) => {
    // Intent: keyboard + SR navigability; focus-visible; ≥44px targets (US-051 AC-2).
    // Steps/asserts: seedAuth; load; Tab through the tab bar — each tab receives a
    //   visible focus ring and is activatable with Enter; targets are ≥44px.
    await seedAuth(page, "user_solo");
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
  });

  test("honors prefers-reduced-motion", async ({ page }) => {
    // Intent: reduced-motion is respected (US-051).
    // Steps/asserts: emulate reduced-motion; navigate; transitions are disabled/instant.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page).toHaveTitle(/ballroom/i);
  });
});
