// The stale-bundle reload nudge. The worker + SPA deploy atomically, so the
// only version skew after a rollout is tabs still RUNNING the old bundle — and
// every compat story (the D10 sync-wire cutover note, REST contract changes)
// resolves to "the tab reloads onto the matching bundle". This module is what
// actually makes that happen: compare the bundle's baked-in build id against
// /api/health's, and reload the tab (when it next becomes visible — never
// mid-interaction) if they differ.
import { describe, expect, it, vi } from "vitest";
import {
  createStaleBundleChecker,
  MIN_CHECK_INTERVAL_MS,
  MIN_RELOAD_INTERVAL_MS,
  type StaleBundleDeps,
} from "./stale-bundle";

/** A tiny in-memory sessionStorage stand-in (jsdom's is fine too, but this keeps
 *  each test's guard state isolated and inspectable). */
function fakeStorage(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

function deps(over: Partial<StaleBundleDeps> = {}): StaleBundleDeps {
  return {
    myBuildId: "sha_old",
    fetchServerBuildId: vi.fn(async () => "sha_new"),
    reload: vi.fn(),
    updateServiceWorker: vi.fn(async () => {}),
    now: () => 1_000_000,
    storage: fakeStorage(),
    ...over,
  };
}

describe("stale-bundle reload nudge", () => {
  it("reloads when the server reports a different build id", async () => {
    const d = deps();
    const checker = createStaleBundleChecker(d);
    expect(await checker.check()).toBe("reloaded");
    expect(d.reload).toHaveBeenCalledOnce();
    // The service worker is nudged BEFORE the reload, so the reload lands on
    // the freshly-precached bundle rather than the old precache (which would
    // otherwise reload onto the same stale code).
    expect(d.updateServiceWorker).toHaveBeenCalledOnce();
  });

  it("does nothing when the ids match", async () => {
    const d = deps({ fetchServerBuildId: vi.fn(async () => "sha_old") });
    expect(await createStaleBundleChecker(d).check()).toBe("fresh");
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("never reloads a build without a build id (dev/test/E2E bundles)", async () => {
    const d = deps({ myBuildId: undefined });
    expect(await createStaleBundleChecker(d).check()).toBe("skipped");
    expect(d.fetchServerBuildId).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("treats a null server build id (not a real deploy) as fresh", async () => {
    const d = deps({ fetchServerBuildId: vi.fn(async () => null) });
    expect(await createStaleBundleChecker(d).check()).toBe("fresh");
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("swallows a health-fetch failure without reloading (offline tab)", async () => {
    const d = deps({ fetchServerBuildId: vi.fn(async () => Promise.reject(new Error("net"))) });
    expect(await createStaleBundleChecker(d).check()).toBe("skipped");
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("throttles checks: a second check inside the interval doesn't re-fetch", async () => {
    let t = 1_000_000;
    const fetchServerBuildId = vi.fn(async () => "sha_old");
    const d = deps({ fetchServerBuildId, now: () => t });
    const checker = createStaleBundleChecker(d);
    await checker.check();
    t += MIN_CHECK_INTERVAL_MS - 1;
    expect(await checker.check()).toBe("skipped");
    expect(fetchServerBuildId).toHaveBeenCalledOnce();
    t += 2; // past the interval → checks again
    await checker.check();
    expect(fetchServerBuildId).toHaveBeenCalledTimes(2);
  });

  it("won't reload-loop: a recent forced reload (persisted across the reload) blocks the next", async () => {
    const storage = fakeStorage();
    const first = deps({ storage });
    expect(await createStaleBundleChecker(first).check()).toBe("reloaded");

    // Simulate the tab AFTER the forced reload: same sessionStorage, but the SW
    // still served the stale bundle (worst case) so the ids still mismatch.
    const after = deps({ storage, now: () => 1_000_000 + MIN_RELOAD_INTERVAL_MS - 1 });
    expect(await createStaleBundleChecker(after).check()).toBe("stale");
    expect(after.reload).not.toHaveBeenCalled();

    // Once the guard window passes, it may try again.
    const later = deps({ storage, now: () => 1_000_000 + MIN_RELOAD_INTERVAL_MS + 1 });
    expect(await createStaleBundleChecker(later).check()).toBe("reloaded");
    expect(later.reload).toHaveBeenCalledOnce();
  });

  it("still reloads when the service-worker nudge itself fails", async () => {
    const d = deps({ updateServiceWorker: vi.fn(async () => Promise.reject(new Error("sw"))) });
    expect(await createStaleBundleChecker(d).check()).toBe("reloaded");
    expect(d.reload).toHaveBeenCalledOnce();
  });
});
