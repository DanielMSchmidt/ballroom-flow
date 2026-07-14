// Stale-bundle reload nudge — closes the open-tab version-skew window.
//
// The worker and the SPA deploy ATOMICALLY (one wrangler deploy ships both), so
// after a rollout the only peer running old code is a browser tab that loaded
// its bundle before the deploy. Every cross-version compat story in this repo
// (the D10 sync-wire cutover note in @weavesteps/contract, additive REST
// changes) resolves to "the tab reloads onto the matching bundle" — but nothing
// told a tab it was stale: the PWA service worker auto-updates its precache,
// while the RUNNING page keeps its old JS indefinitely.
//
// This module is that signal's FALLBACK half (since 2026-07-14 the fast path
// is SW-driven — lib/sw-update.ts reloads the moment an updated service worker
// activates; this build-id handshake stays to catch a broken/stale service
// worker that path can't see). The deploy bakes the git SHA into the bundle
// (VITE_BUILD_ID) and into the worker (BUILD_ID, surfaced on /api/health).
// Whenever the tab becomes VISIBLE — the user returning to a backgrounded tab
// is exactly the stale case, and a reload at that instant can't interrupt
// typing — we compare the two and reload on mismatch.
//
// Safety properties (each pinned in stale-bundle.test.ts):
//   • Dev/test/E2E bundles carry no build id → never reload.
//   • The service worker is nudged to update BEFORE reloading, so the reload
//     lands on the new precache rather than the old one.
//   • A forced-reload stamp in sessionStorage (per-tab, survives the reload)
//     rate-limits retries, so a worst-case stale service worker can never
//     cause a reload loop.
//   • Checks are throttled; a health-fetch failure (offline) does nothing.

/** Everything the checker touches, injectable so tests drive it deterministically. */
export interface StaleBundleDeps {
  /** This bundle's baked-in build id (`import.meta.env.VITE_BUILD_ID`). */
  myBuildId: string | undefined;
  /** The server's current build id (`/api/health` → `buildId`, null when unset). */
  fetchServerBuildId: () => Promise<string | null>;
  reload: () => void;
  /** Best-effort: ask the service worker to fetch the new precache first. */
  updateServiceWorker?: () => Promise<void>;
  now?: () => number;
  /** Persists the forced-reload stamp ACROSS the reload (sessionStorage: per-tab). */
  storage?: Pick<Storage, "getItem" | "setItem">;
}

/** Don't hit /api/health more than once per window (visibility events can burst). */
export const MIN_CHECK_INTERVAL_MS = 5 * 60_000;
/** Min gap between FORCED reloads — the reload-loop guard for a stale SW precache. */
export const MIN_RELOAD_INTERVAL_MS = 10 * 60_000;

const RELOAD_STAMP_KEY = "weavesteps:stale-bundle:last-forced-reload";

/** What a check() concluded — "stale" = mismatch seen but reload withheld (loop guard). */
export type StaleCheckResult = "fresh" | "stale" | "reloaded" | "skipped";

export function createStaleBundleChecker(deps: StaleBundleDeps): {
  check: () => Promise<StaleCheckResult>;
} {
  const now = deps.now ?? Date.now;
  let lastCheckAt = Number.NEGATIVE_INFINITY;

  async function check(): Promise<StaleCheckResult> {
    // A build without an id (dev server, tests, the E2E bundle) can never be
    // declared stale — fail safe toward "do nothing".
    if (!deps.myBuildId) return "skipped";
    if (now() - lastCheckAt < MIN_CHECK_INTERVAL_MS) return "skipped";
    lastCheckAt = now();

    let server: string | null;
    try {
      server = await deps.fetchServerBuildId();
    } catch {
      return "skipped"; // offline / transient — a later visibility event retries
    }
    if (!server || server === deps.myBuildId) return "fresh";

    // Stale. Rate-limit forced reloads (sessionStorage survives the reload but
    // stays per-tab), so a service worker still serving the old precache can't
    // spin this tab in a reload loop.
    const stampRaw = deps.storage?.getItem(RELOAD_STAMP_KEY);
    const stamp = stampRaw ? Number(stampRaw) : Number.NEGATIVE_INFINITY;
    if (now() - stamp < MIN_RELOAD_INTERVAL_MS) return "stale";

    // Give the service worker a chance to precache the new bundle first, so
    // the reload actually lands on new code. Best-effort: a failure here must
    // not block the reload (the network fetch fallback still works).
    try {
      await deps.updateServiceWorker?.();
    } catch {
      // ignore — reload anyway
    }
    deps.storage?.setItem(RELOAD_STAMP_KEY, String(now()));
    deps.reload();
    return "reloaded";
  }

  return { check };
}

/**
 * Production wiring: check whenever the tab becomes visible — a user returning
 * to a backgrounded tab is exactly the stale-after-deploy case, and reloading
 * at that moment never interrupts in-flight editing. Called once from main.tsx.
 */
export function initStaleBundleReload(): void {
  if (typeof document === "undefined") return;
  const checker = createStaleBundleChecker({
    myBuildId: import.meta.env.VITE_BUILD_ID,
    fetchServerBuildId: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) return null;
      const body: unknown = await res.json();
      // Narrow the untrusted health payload — anything else reads as "unknown".
      return typeof body === "object" &&
        body !== null &&
        "buildId" in body &&
        typeof body.buildId === "string"
        ? body.buildId
        : null;
    },
    reload: () => window.location.reload(),
    updateServiceWorker: async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
    },
    storage: window.sessionStorage,
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checker.check();
  });
}
