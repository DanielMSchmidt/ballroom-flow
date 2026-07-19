// First-visit UI tour runner (driver.js).
// =================================================================
// Shows a page's coach-mark tour the FIRST time that page is viewed, then
// never again (a `bb_tour_<page>` localStorage flag — same best-effort
// persistence pattern as the `bb_role` reading lens). The tour is always
// skippable: the ✕ close control, clicking the dimmed overlay, and Escape all
// end it immediately (driver.js `allowClose`, on by default).
//
// Library choice (2026-07): driver.js — MIT, ~5 kB gzipped, zero dependencies,
// framework-agnostic (no React-version coupling), and styled with plain CSS so
// the popover is themed from the `--bf-*` tokens (styles/index.css) instead of
// fighting inline styles. Evaluated against react-joyride (heavier, inline
// styles), shepherd.js (floating-ui dependency), intro.js (AGPL/commercial).
//
// Environment gating: never auto-runs in unit tests (vitest MODE=test) or the
// deterministic E2E build (`.bf-e2e` on <html>), and honors
// prefers-reduced-motion by disabling the popover/stage animations (#9).
import { type Driver, driver } from "driver.js";
import { useCallback, useEffect } from "react";
import { pickMessages } from "../i18n/messages";
import { tourMessages } from "../i18n/messages/tours";
import { TOUR_PAGE_IDS, TOURS, type TourPageId, type TourStepDef } from "./tours";

/** The per-page "already shown" localStorage key. */
export function tourSeenKey(page: TourPageId): string {
  return `bb_tour_${page}`;
}

/** Has this page's tour already been shown? Storage failures (private mode,
 *  blocked storage) read as "seen" so the tour can never nag on every visit. */
export function hasSeenTour(page: TourPageId): boolean {
  try {
    return localStorage.getItem(tourSeenKey(page)) != null;
  } catch {
    return true;
  }
}

export function markTourSeen(page: TourPageId): void {
  try {
    localStorage.setItem(tourSeenKey(page), "done");
  } catch {
    // Best-effort — without storage the gate above already reads "seen".
  }
}

/** Forget every page's tour so each shows again on its next visit
 *  (the Profile "Replay the intro tours" affordance). */
export function resetAllTours(pages: readonly TourPageId[]): void {
  try {
    for (const page of pages) localStorage.removeItem(tourSeenKey(page));
  } catch {
    // Best-effort.
  }
}

/** Should tours auto-run in this environment at all? */
export function isTourEnvironment(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  // Unit tests (jsdom) — a tour overlay would leak into unrelated assertions.
  if (import.meta.env.MODE === "test") return false;
  // Deterministic E2E build (#191): journeys script the real UI, not the tour.
  if (document.documentElement.classList.contains("bf-e2e")) return false;
  return true;
}

/** The first VISIBLE match for a selector — the nav (for one) renders both a
 *  mobile bar and a desktop rail, and driver.js must highlight the one that's
 *  actually on screen. */
function visibleTarget(selector: string): Element | undefined {
  const all = Array.from(document.querySelectorAll(selector));
  return (
    all.find((el) => el instanceof HTMLElement && el.offsetParent !== null) ??
    // `position: fixed` elements have a null offsetParent but ARE visible.
    all.find((el) => el instanceof HTMLElement && el.getClientRects().length > 0)
  );
}

/** Map a page's step defs onto driver.js steps, dropping steps whose target
 *  isn't in the (visible) DOM right now. */
function resolveSteps(defs: TourStepDef[]) {
  return defs.flatMap((def) => {
    if (!def.element) {
      return [{ popover: { title: def.title, description: def.description } }];
    }
    const el = visibleTarget(def.element);
    if (!el) return [];
    return [{ element: el, popover: { title: def.title, description: def.description } }];
  });
}

/**
 * Start a page's tour NOW (regardless of the seen flag) and mark it seen.
 * Returns the Driver when it started, or null when nothing was anchorable.
 */
export function startTour(page: TourPageId): Driver | null {
  const steps = resolveSteps(TOURS[page]);
  if (steps.length === 0) return null;
  // Seen is stamped at START (not completion): once shown, a tour never
  // re-nags — skipping IS a completion (#16-adjacent: user stays in control).
  markTourSeen(page);
  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Late layout changes (content still hydrating below the anchor) reflow the
  // page WITHOUT a window resize — driver.js only re-anchors on resize/scroll,
  // so a growing page left the spotlight pinned to a stale rect. Watch the body
  // and re-measure the active highlight on any reflow.
  let reflowWatch: ResizeObserver | undefined;
  // Resolved at start time so the chrome follows the active locale. The
  // {{current}}/{{total}} placeholders are driver.js template syntax and are
  // kept verbatim in every language of the catalog.
  const chrome = pickMessages(tourMessages).chrome;
  const d = driver({
    steps,
    animate: !reducedMotion,
    showProgress: steps.length > 1,
    progressText: chrome.progress,
    nextBtnText: chrome.next,
    prevBtnText: chrome.back,
    doneBtnText: chrome.done,
    // allowClose (default true) keeps every skip path open: ✕, overlay, Escape.
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 10,
    popoverClass: "bf-tour",
    onDestroyed: () => reflowWatch?.disconnect(),
  });
  d.drive();
  if (typeof ResizeObserver !== "undefined") {
    reflowWatch = new ResizeObserver(() => {
      if (d.isActive()) d.refresh();
    });
    reflowWatch.observe(document.body);
  }
  return d;
}

/**
 * useFirstVisitTour — run `page`'s tour once, the first time the page is
 * viewed. `ready` lets a screen hold the tour until its content exists (e.g.
 * Assemble waits for the routine to load); the tour starts on the first
 * render where `ready` is true and the environment allows it.
 */
export function useFirstVisitTour(page: TourPageId, ready = true): void {
  useEffect(() => {
    if (!ready || !isTourEnvironment() || hasSeenTour(page)) return;
    // Give the frame a beat to settle (fonts/layout) so the spotlight lands
    // on the control's final position.
    const t = window.setTimeout(() => {
      if (!hasSeenTour(page)) startTour(page);
    }, 400);
    return () => window.clearTimeout(t);
  }, [page, ready]);
}

/** A stable "replay the tours" callback for the Profile affordance: clears
 *  every seen flag, then immediately replays the current page's tour. */
export function useReplayTours(currentPage: TourPageId): () => void {
  return useCallback(() => {
    resetAllTours(TOUR_PAGE_IDS);
    startTour(currentPage);
  }, [currentPage]);
}
