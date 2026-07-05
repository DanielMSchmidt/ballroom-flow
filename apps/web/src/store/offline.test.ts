// PLAN §11.2 — offline app open: the last-good REST read (choreo list, /api/me)
// is cached on-device and served when a fetch fails WHILE OFFLINE, so opening
// the installed app in airplane mode lands on the normal (possibly empty) list
// instead of an error/empty flash. Online failures still surface — the cache
// never masks a real server error.
import { afterEach, describe, expect, it } from "vitest";
import { withOfflineCache } from "./offline";

const goOffline = (): void => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
};

afterEach(() => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  localStorage.clear();
});

describe("withOfflineCache (PLAN §11.2 — offline app open)", () => {
  it("writes through on success and serves the cache when offline", async () => {
    const first = await withOfflineCache("bf_test", async () => ({ routines: ["a"] }));
    expect(first).toEqual({ routines: ["a"] });

    goOffline();
    const offline = await withOfflineCache("bf_test", async () => {
      throw new Error("network down");
    });
    expect(offline).toEqual({ routines: ["a"] }); // the last-good response
  });

  it("rethrows an ONLINE failure even when a cache exists (never masks server errors)", async () => {
    await withOfflineCache("bf_test", async () => ({ ok: true }));
    await expect(
      withOfflineCache("bf_test", async () => {
        throw new Error("500");
      }),
    ).rejects.toThrow("500");
  });

  it("rethrows offline when nothing was ever cached (honest empty/error state)", async () => {
    goOffline();
    await expect(
      withOfflineCache("bf_never", async () => {
        throw new Error("network down");
      }),
    ).rejects.toThrow("network down");
  });
});
