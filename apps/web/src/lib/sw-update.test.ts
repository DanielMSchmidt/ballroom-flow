// Service-worker-driven update reload — the FAST half of the rollout-skew
// story (docs/system/sync-and-offline.md § Version skew). The SW precache updates itself via periodic/visibility
// update checks; when an UPDATED service worker takes control (controllerchange
// with a controller already present at startup — new precache live), the tab
// reloads onto it at the first moment that can't interrupt the user:
// immediately before any interaction (the cold-open case — the 2026-07-14
// Feather-mismatch incident: a fresh tab kept rendering the pre-fix bundle
// for a whole session) or while hidden, otherwise on the next visibility
// change. Complements lib/stale-bundle.ts (the /api/health build-id fallback).
import { describe, expect, it, vi } from "vitest";
import { createSwUpdateController, MIN_UPDATE_CHECK_GAP_MS, type SwUpdateDeps } from "./sw-update";

function deps(over: Partial<SwUpdateDeps> = {}): SwUpdateDeps {
  return {
    reload: vi.fn(),
    visibility: () => "visible",
    // Default: this page was already SW-controlled, so any controllerchange
    // is an UPDATE taking over (the common steady-state case).
    hasController: () => true,
    now: () => 1_000_000,
    ...over,
  };
}

describe("sw-update reload policy", () => {
  it("reloads immediately when the update takes control before any interaction (cold open)", () => {
    const d = deps();
    const c = createSwUpdateController(d);
    c.onControllerChange();
    expect(d.reload).toHaveBeenCalledOnce();
  });

  it("never reloads for the FIRST install claiming an uncontrolled page", () => {
    const d = deps({ hasController: () => false });
    const c = createSwUpdateController(d);
    c.onControllerChange(); // first install claims the page — this IS current
    expect(d.reload).not.toHaveBeenCalled();
    c.onControllerChange(); // …but a takeover after that is a real update
    expect(d.reload).toHaveBeenCalledOnce();
  });

  it("reloads immediately when the update takes control while the tab is hidden", () => {
    const d = deps({ visibility: () => "hidden" });
    const c = createSwUpdateController(d);
    c.onUserInteraction(); // even a used tab reloads invisibly while hidden
    c.onControllerChange();
    expect(d.reload).toHaveBeenCalledOnce();
  });

  it("defers the reload in a visible, interacted-with tab until the next visibility change", () => {
    const d = deps();
    const c = createSwUpdateController(d);
    c.onUserInteraction();
    c.onControllerChange();
    expect(d.reload).not.toHaveBeenCalled(); // never mid-interaction
    c.onVisibilityChange();
    expect(d.reload).toHaveBeenCalledOnce();
  });

  it("a visibility change without a pending update never reloads", () => {
    const d = deps();
    const c = createSwUpdateController(d);
    c.onUserInteraction();
    c.onVisibilityChange();
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("reloads at most once, however many signals arrive", () => {
    const d = deps();
    const c = createSwUpdateController(d);
    c.onControllerChange();
    c.onControllerChange();
    c.onVisibilityChange();
    c.onVisibilityChange();
    expect(d.reload).toHaveBeenCalledOnce();
  });
});

describe("sw-update check scheduling", () => {
  it("checkForUpdate without a registration is a safe no-op", () => {
    const c = createSwUpdateController(deps());
    expect(() => c.checkForUpdate()).not.toThrow();
  });

  it("asks the registration to update, throttled to the min gap", () => {
    let t = 1_000_000;
    const update = vi.fn(async () => {});
    const c = createSwUpdateController(deps({ now: () => t }));
    c.onRegistered({ update });
    // Registration itself just fetched sw.js — an immediate re-check is wasted.
    c.checkForUpdate();
    expect(update).not.toHaveBeenCalled();
    t += MIN_UPDATE_CHECK_GAP_MS + 1;
    c.checkForUpdate();
    expect(update).toHaveBeenCalledOnce();
    // A burst inside the gap (visibility flapping) doesn't re-fetch…
    t += MIN_UPDATE_CHECK_GAP_MS - 1;
    c.checkForUpdate();
    expect(update).toHaveBeenCalledOnce();
    // …but the next tick past the gap does.
    t += 2;
    c.checkForUpdate();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("swallows an update-check failure (offline tab)", async () => {
    let t = 1_000_000;
    const update = vi.fn(async () => Promise.reject(new Error("net")));
    const c = createSwUpdateController(deps({ now: () => t }));
    c.onRegistered({ update });
    t += MIN_UPDATE_CHECK_GAP_MS + 1;
    expect(() => c.checkForUpdate()).not.toThrow();
    await Promise.resolve(); // let the rejection settle — must not go unhandled
    expect(update).toHaveBeenCalledOnce();
  });
});
