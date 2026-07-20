import type { FigureDoc, RoutineDoc } from "@weavesteps/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { asTestDouble } from "../test-support/test-double";
import { openRoutineSnapshot, type RoutineSnapshot } from "./routine-snapshot";

// ─────────────────────────────────────────────────────────────────────────
// Read-only snapshot model (read/edit split). One REST hydrate + light polling +
// refetch-on-focus, NO WebSockets. Exposes the same read surface as the live
// store so a screen can read cheaply and upgrade to the live store only to edit.
// ─────────────────────────────────────────────────────────────────────────

const routine = (figureRef: string): RoutineDoc => ({
  id: "rt_snap",
  title: "Gold Waltz",
  dance: "waltz",
  ownerId: "u",
  sections: [
    {
      id: "s1",
      name: "Part 1",
      deletedAt: null,
      placements: [{ id: "p1", figureRef, deletedAt: null }],
    },
  ],
  annotations: [],
  schemaVersion: 1,
  deletedAt: null,
});

const figure = (id: string, name: string): FigureDoc => ({
  id,
  scope: "account",
  ownerId: "u",
  figureType: "natural-turn",
  dance: "waltz",
  name,
  source: "custom",
  attributes: [],
  schemaVersion: 1,
  deletedAt: null,
});

/** Wiring whose poll timer + focus hook are captured so the test can fire them. */
function wiring(data: RoutineSnapshot) {
  let pollFn: (() => void) | null = null;
  let focusFn: (() => void) | null = null;
  const fetchSnapshot = vi.fn(async () => data);
  const opts = {
    fetchSnapshot,
    schedule: (fn: () => void) => {
      pollFn = fn;
      // Opaque timer handle the fake never inspects (cancel is a spy too).
      return asTestDouble<ReturnType<typeof setInterval>>(1);
    },
    cancel: vi.fn(),
    onFocusRefetch: (fn: () => void) => {
      focusFn = fn;
      return () => {};
    },
  };
  return { opts, fetchSnapshot, firePoll: () => pollFn?.(), fireFocus: () => focusFn?.() };
}

describe("openRoutineSnapshot", () => {
  it("hydrates the routine + resolves referenced figures from one fetch", async () => {
    const data = { routine: routine("fig1"), figures: { fig1: figure("fig1", "Natural Turn") } };
    const { opts, fetchSnapshot } = wiring(data);
    const model = openRoutineSnapshot("rt_snap", opts);

    // Starts "connecting"; flips to "live" after the first fetch resolves.
    expect(model.syncState()).toBe("connecting");
    await vi.waitFor(() => expect(model.syncState()).toBe("live"));
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    const placements = model.readPlacements();
    expect(placements).toHaveLength(1);
    expect(placements[0]?.figure?.name).toBe("Natural Turn");
    expect(model.readRoutine().title).toBe("Gold Waltz");
    model.close();
  });

  it("renders a placement whose figure is absent from the snapshot as null (missing)", async () => {
    // The routine references fig_missing but the snapshot omits it (deleted/no access).
    const data = { routine: routine("fig_missing"), figures: {} };
    const { opts } = wiring(data);
    const model = openRoutineSnapshot("rt_snap", opts);
    await vi.waitFor(() => expect(model.syncState()).toBe("live"));
    expect(model.readPlacements()[0]?.figure).toBeNull();
    model.close();
  });

  it("refetches on the poll tick and on focus, and notifies subscribers", async () => {
    const data = { routine: routine("fig1"), figures: { fig1: figure("fig1", "Natural Turn") } };
    const { opts, fetchSnapshot, firePoll, fireFocus } = wiring(data);
    const model = openRoutineSnapshot("rt_snap", opts);
    await vi.waitFor(() => expect(model.syncState()).toBe("live"));

    let notified = 0;
    model.subscribe(() => {
      notified++;
    });

    // Let each in-flight fetch SETTLE before the next trigger — concurrent loads
    // coalesce by design (one request at a time), so the test must flush between.
    const flush = async () => {
      for (let i = 0; i < 3; i++) await Promise.resolve();
    };
    firePoll();
    await flush();
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    fireFocus();
    await flush();
    expect(fetchSnapshot).toHaveBeenCalledTimes(3);
    expect(notified).toBeGreaterThanOrEqual(2);
    model.close();
  });

  it("after close, a poll tick does not fetch again", async () => {
    const data = { routine: routine("fig1"), figures: { fig1: figure("fig1", "X") } };
    const { opts, fetchSnapshot, firePoll } = wiring(data);
    const model = openRoutineSnapshot("rt_snap", opts);
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(1));
    model.close();
    firePoll();
    await Promise.resolve();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });
});

// #275 — the DEFAULT snapshot fetch (no injected fetchSnapshot) wires the
// authed-401 fresh-token retry: this 20s poll can outlive a token's `exp`, so an
// authed 401 should mint a fresh token (skipCache) and retry ONCE before failing
// or reporting. Drives the real fetch path (stubbed global fetch) to prove it.
describe("openRoutineSnapshot authed-401 token refresh (#275)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("on an authed 401, force-refreshes the token and re-fetches, then hydrates", async () => {
    const data = { routine: routine("fig1"), figures: { fig1: figure("fig1", "Natural Turn") } };
    const skipCacheFlags: (boolean | undefined)[] = [];
    const getToken = vi.fn(async (o?: { skipCache?: boolean }) => {
      skipCacheFlags.push(o?.skipCache);
      return o?.skipCache ? "fresh-token" : "stale-token";
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const model = openRoutineSnapshot("rt_snap", {
      getToken,
      pollMs: 0, // no background poll — assert the single hydrate's behaviour
      onFocusRefetch: () => () => {},
    });

    await vi.waitFor(() => expect(model.syncState()).toBe("live"));
    // First the cached token; then a skipCache refresh after the 401.
    expect(skipCacheFlags).toEqual([undefined, true]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(model.readPlacements()[0]?.figure?.name).toBe("Natural Turn");
    model.close();
  });
});
