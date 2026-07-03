// First-visit tour runner — the storage gate + step resolution + skippability
// wiring. driver.js itself is mocked: these tests pin OUR contract (when a tour
// runs, what it's configured with), not the library's rendering.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { drive, driverFactory } = vi.hoisted(() => {
  const drive = vi.fn();
  return {
    drive,
    driverFactory: vi.fn((_config?: unknown) => ({ drive, destroy: vi.fn() })),
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
    const config = driverFactory.mock.calls[0]?.[0] as { steps: unknown[] };
    expect(config.steps).toHaveLength(1);
  });

  it("anchors steps to visible [data-tour] targets", () => {
    // jsdom has no layout, so offsetParent is null — the fixed-position
    // fallback (getClientRects) is what finds the element here.
    const el = document.createElement("button");
    el.setAttribute("data-tour", "new-choreo");
    el.getClientRects = () => [{}] as unknown as DOMRectList;
    document.body.appendChild(el);
    startTour("choreos");
    const config = driverFactory.mock.calls[0]?.[0] as {
      steps: { element?: Element }[];
    };
    expect(config.steps).toHaveLength(2);
    expect(config.steps[1]?.element).toBe(el);
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
    const config = driverFactory.mock.calls[0]?.[0] as { allowClose?: boolean };
    // driver.js defaults allowClose to true; we must never turn it off.
    expect(config.allowClose).not.toBe(false);
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
});
