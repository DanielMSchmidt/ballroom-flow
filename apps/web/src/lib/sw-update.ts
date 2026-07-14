// Service-worker-driven update reload — the FAST half of the rollout-skew
// story (PLAN §7 "Version evolution / rollout skew").
//
// Motivating incident (2026-07-14, the Feather-step count mismatch): a fix
// deployed at 17:48 was still invisible at 18:52 — a freshly opened tab is
// served the OLD precache by the service worker, and nothing reloaded it. The
// plugin's default injected registration only calls `register()`; with
// skipWaiting + clientsClaim the NEW service worker silently takes control in
// the background while the running page keeps its old JS indefinitely. The
// stale-bundle nudge (lib/stale-bundle.ts) only checks on visibility-return,
// so a cold open or a continuously-foregrounded session could run stale code
// for hours.
//
// This module registers the service worker itself (vite.config.ts sets
// `injectRegister: false`; no library — `virtual:pwa-register` needs
// workbox-window, a transitive dep pnpm's strict layout won't resolve from
// here, and the two signals we need are plain platform events) and steers two
// loops:
//
//   • UPDATE CHECKS — ask the browser to re-fetch sw.js (a tiny, mostly-304
//     GET) on a timer while the app stays open, when the tab becomes visible,
//     and when the network comes back. The browser otherwise only checks on
//     navigation (or every 24 h), which is exactly how a session lags a deploy.
//   • RELOAD — when an UPDATED service worker TAKES CONTROL (the
//     `controllerchange` event with a controller already present at startup;
//     first-install claims are ignored). Its precache was fully populated
//     during install, so a reload is guaranteed to land on the new bundle —
//     unlike the stale-bundle nudge's fire-and-hope `update()`. Reload at the
//     first moment that can't interrupt the user: immediately while the tab is
//     hidden or before any interaction (the cold-open case), otherwise on the
//     next visibility change — the same "never mid-interaction" invariant
//     stale-bundle.ts established. CRDT edits are locally persisted (§11.2
//     offline editing), so a reload never loses saved work.
//
// No reload-loop risk: `controllerchange` fires once per NEW service worker
// taking control; after the reload the new worker is simply current. The
// /api/health build-id check in stale-bundle.ts stays as the belt-and-braces
// fallback for a broken/stale service worker.

/** The generated service worker's URL (vite-plugin-pwa default filename). */
export const SW_URL = "/sw.js";
/** How often an open tab re-checks sw.js for a new deploy. */
export const SW_UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;
/** Min gap between update checks — visibility events can burst. */
export const MIN_UPDATE_CHECK_GAP_MS = 60_000;

/** Everything the controller touches, injectable so tests drive it deterministically. */
export interface SwUpdateDeps {
  reload: () => void;
  /** Reads the tab's visibility at decision time (`document.visibilityState`). */
  visibility: () => DocumentVisibilityState;
  /** Whether a service worker already controlled this page at startup — the
   *  discriminator between a first install claiming the page (no reload) and
   *  an UPDATE taking over (reload). */
  hasController: () => boolean;
  now?: () => number;
}

/** The slice of ServiceWorkerRegistration this module needs. */
export interface UpdatableRegistration {
  update: () => Promise<unknown>;
}

export interface SwUpdateController {
  /** Hands over the fulfilled registration to poll for updates. */
  onRegistered(registration: UpdatableRegistration | undefined): void;
  /** Timer / became-visible / back-online tick: re-check sw.js (throttled). */
  checkForUpdate(): void;
  /** Wire to `navigator.serviceWorker`'s `controllerchange` event. */
  onControllerChange(): void;
  /** Any pointer/key input — after this, a visible tab is never yanked. */
  onUserInteraction(): void;
  /** Any visibilitychange — the deferred reload's safe moment. */
  onVisibilityChange(): void;
}

export function createSwUpdateController(deps: SwUpdateDeps): SwUpdateController {
  const now = deps.now ?? Date.now;
  let registration: UpdatableRegistration | undefined;
  let lastCheckAt = Number.NEGATIVE_INFINITY;
  let hadController = deps.hasController();
  let interacted = false;
  let pendingReload = false;
  let reloaded = false;

  function reloadOnce(): void {
    if (reloaded) return;
    reloaded = true;
    pendingReload = false;
    deps.reload();
  }

  return {
    onRegistered(reg) {
      registration = reg;
      // Registering just fetched sw.js — start the throttle window now so the
      // first interval/visibility tick doesn't immediately re-fetch it.
      lastCheckAt = now();
    },
    checkForUpdate() {
      if (!registration) return;
      if (now() - lastCheckAt < MIN_UPDATE_CHECK_GAP_MS) return;
      lastCheckAt = now();
      // Fire-and-forget: a failed check (offline) is retried by the next tick.
      registration.update().catch(() => {});
    },
    onControllerChange() {
      // First install (clientsClaim claims an uncontrolled page): nothing to
      // reload onto — this page IS the current bundle. Remember the takeover
      // so the next change reads as an update.
      if (!hadController) {
        hadController = true;
        return;
      }
      // An UPDATED worker took control: its precache is live. Hidden: the
      // reload is invisible. Pre-interaction: the user hasn't invested
      // anything in this page yet (the cold-open case). Otherwise hold the
      // reload for the next visibility transition.
      if (deps.visibility() === "hidden" || !interacted) reloadOnce();
      else pendingReload = true;
    },
    onUserInteraction() {
      interacted = true;
    },
    onVisibilityChange() {
      // Either direction is safe: →hidden reloads out of sight; →visible is
      // the return-to-tab moment stale-bundle.ts already reloads at.
      if (pendingReload) reloadOnce();
    },
  };
}

/**
 * Production wiring — called once from main.tsx. Registers the service worker
 * (on window load, like the injected script it replaces) and drives the
 * controller from the real DOM signals. No-op in dev: the dev server has no
 * sw.js (devOptions are disabled), so there's nothing to register or update.
 */
export function initSwUpdateReload(): void {
  if (typeof document === "undefined" || typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) return;
  const sw = navigator.serviceWorker;
  const controller = createSwUpdateController({
    reload: () => window.location.reload(),
    visibility: () => document.visibilityState,
    hasController: () => sw.controller !== null,
  });
  sw.addEventListener("controllerchange", () => controller.onControllerChange());
  const register = () => {
    sw.register(SW_URL)
      .then((registration) => {
        controller.onRegistered(registration);
        window.setInterval(() => controller.checkForUpdate(), SW_UPDATE_CHECK_INTERVAL_MS);
      })
      // Registration refused (private mode, misconfig) — the stale-bundle
      // fallback still covers version skew; the app itself works SW-less.
      .catch(() => {});
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
  document.addEventListener("visibilitychange", () => {
    controller.onVisibilityChange();
    if (document.visibilityState === "visible") controller.checkForUpdate();
  });
  window.addEventListener("online", () => controller.checkForUpdate());
  for (const event of ["pointerdown", "keydown"] as const) {
    document.addEventListener(event, () => controller.onUserInteraction(), {
      capture: true,
      passive: true,
    });
  }
}
