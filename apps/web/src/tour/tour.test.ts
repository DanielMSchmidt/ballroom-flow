// First-visit tour runner — the storage gate + step resolution + skippability
// wiring. driver.js itself is mocked: these tests pin OUR contract (when a tour
// runs, what it's configured with), not the library's rendering.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asTestDouble } from "../test-support/test-double";

const { drive, refresh, driverFactory } = vi.hoisted(() => {
  const drive = vi.fn();
  const refresh = vi.fn();
  return {
    drive,
    refresh,
    // The config parameter is typed structurally on the fields these tests
    // assert, so mock.calls hands them back typed (driver.js's own Config
    // can't be imported here — vi.hoisted runs before module imports).
    driverFactory: vi.fn(
      (_config?: {
        steps?: { element?: Element }[];
        allowClose?: boolean;
        onDestroyed?: () => void;
      }) => ({
        drive,
        refresh,
        isActive: () => true,
        destroy: vi.fn(),
      }),
    ),
  };
});
vi.mock("driver.js", () => ({ driver: driverFactory }));

import { TOUR_PAGE_IDS, TOURS } from "./tours";
import {
  hasSeenTour,
  isTourEnvironment,
  markTourSeen,
  resetAllTours,
  startTour,
  tourSeenKey,
} from "./useFirstVisitTour";

beforeEach(() => {
  localStorage.clear();
  driverFactory.mockClear();
  drive.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("tour seen-flag storage (bb_tour_<page>)", () => {
  it("is unseen by default, seen after marking", () => {
    expect(hasSeenTour("choreos")).toBe(false);
    markTourSeen("choreos");
    expect(hasSeenTour("choreos")).toBe(true);
    expect(localStorage.getItem(tourSeenKey("choreos"))).toBe("done");
  });

  it("resets every page's flag for the replay affordance", () => {
    for (const page of TOUR_PAGE_IDS) markTourSeen(page);
    resetAllTours(TOUR_PAGE_IDS);
    for (const page of TOUR_PAGE_IDS) expect(hasSeenTour(page)).toBe(false);
  });
});

describe("startTour", () => {
  it("drops steps whose target is not in the DOM and starts with the rest", () => {
    // No [data-tour] anchors exist → only the unanchored welcome step survives.
    const d = startTour("choreos");
    expect(d).not.toBeNull();
    expect(drive).toHaveBeenCalledTimes(1);
    const config = driverFactory.mock.calls[0]?.[0];
    expect(config?.steps).toHaveLength(1);
  });

  it("anchors steps to visible [data-tour] targets", () => {
    // jsdom has no layout, so offsetParent is null — the fixed-position
    // fallback (getClientRects) is what finds the element here.
    const el = document.createElement("button");
    el.setAttribute("data-tour", "new-choreo");
    // Only `.length` is read off the rect list — a full DOMRectList is not
    // constructible in jsdom, so hand back a one-element double.
    el.getClientRects = () => asTestDouble<DOMRectList>([{}]);
    document.body.appendChild(el);
    startTour("choreos");
    const config = driverFactory.mock.calls[0]?.[0];
    expect(config?.steps).toHaveLength(2);
    expect(config?.steps?.[1]?.element).toBe(el);
  });

  it("returns null (and does not drive) when nothing is anchorable", () => {
    // The profile tour has no unanchored step — with no DOM targets it skips.
    expect(startTour("profile")).toBeNull();
    expect(drive).not.toHaveBeenCalled();
  });

  it("marks the page seen at start, so a skipped tour never re-nags", () => {
    startTour("choreos");
    expect(hasSeenTour("choreos")).toBe(true);
  });

  it("keeps every skip path open (allowClose is not disabled)", () => {
    startTour("choreos");
    const config = driverFactory.mock.calls[0]?.[0];
    // driver.js defaults allowClose to true; we must never turn it off.
    expect(config?.allowClose).not.toBe(false);
  });
});

describe("startTour re-anchors under late layout changes", () => {
  // The incident: on a slow connection the choreo hydrates AFTER the tour
  // opened, the page grows under the popover, and the highlight stays pinned
  // to a stale rect. driver.js only re-anchors on window resize/scroll — a
  // content-driven reflow fires neither, so startTour watches the body with a
  // ResizeObserver and refreshes the active highlight.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes the active highlight when the body reflows, and disconnects on destroy", () => {
    const observed: Element[] = [];
    const disconnect = vi.fn();
    let trigger: (() => void) | undefined;
    class FakeResizeObserver {
      constructor(cb: () => void) {
        trigger = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      unobserve() {}
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    startTour("choreos");
    expect(observed).toContain(document.body);
    trigger?.();
    expect(refresh).toHaveBeenCalledTimes(1);

    const config = driverFactory.mock.calls[0]?.[0];
    config?.onDestroyed?.();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("environment gating", () => {
  it("never auto-runs under vitest (MODE=test)", () => {
    expect(isTourEnvironment()).toBe(false);
  });
});

describe("tour scripts", () => {
  it("covers every page with 1–5 concise steps", () => {
    for (const page of TOUR_PAGE_IDS) {
      const steps = TOURS[page];
      expect(steps.length, page).toBeGreaterThanOrEqual(1);
      expect(steps.length, page).toBeLessThanOrEqual(5);
      for (const s of steps) {
        expect(s.title.length, page).toBeGreaterThan(0);
        expect(s.description.length, page).toBeGreaterThan(0);
      }
    }
  });

  it("slots the type-chips stop after the header stops, with quick-note last (design 1.26)", () => {
    const elements = TOURS.assemble.map((s) => s.element);
    // Header stops (role · lens · share) first, then the chips, then the
    // sticky ✎ note button as the final stop — "4 of 5" for the chips.
    expect(elements.indexOf("[data-tour='type-chips']")).toBe(3);
    expect(elements[elements.length - 1]).toBe("[data-tour='quick-note']");
  });
});
