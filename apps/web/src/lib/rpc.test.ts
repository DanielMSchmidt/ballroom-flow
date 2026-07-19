// US-049 (web half, 2026-07-05 incident) — the API seam reports UNEXPECTED
// failures. The incident: every authenticated call 401'd in production (Clerk
// instance mismatch) and nothing reported it. The rules pinned here:
//   • 5xx            → report (server broke)
//   • 401 WITH token → report (a signed-in user rejected = the mismatch signature)
//   • network throw  → report (unless the browser says it's offline)
//   • 4xx product flows (402 quota, 401 signed-out, 403) → NOT reported
// Reporting always dedupes via ops.ts keys and NEVER changes what callers see:
// the ApiError still throws exactly as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportError } from "./ops";
import { ApiError, ApiTimeoutError, apiDelete, apiGet, apiPost, shouldRetryQuery } from "./rpc";

vi.mock("./ops", () => ({ reportError: vi.fn() }));
const reportSpy = vi.mocked(reportError);

/** Read the Authorization header the Nth `fetch` call carried. `Headers`
 *  normalizes any HeadersInit (record/array/Headers) the init might use, so this
 *  needs no cast to inspect the mock's recorded arguments. */
function authHeaderOf(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): string | null {
  const init = fetchMock.mock.calls[callIndex]?.[1];
  const headers = init && typeof init === "object" && "headers" in init ? init.headers : undefined;
  return new Headers(headers instanceof Object ? headers : {}).get("Authorization");
}

function respond(status: number, body: unknown = { error: "x" }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

beforeEach(() => reportSpy.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("rpc failure reporting (US-049 / 2026-07-05 incident)", () => {
  it("reports a 5xx and still throws the ApiError unchanged", async () => {
    respond(500);
    await expect(apiGet("/api/routines", "tok")).rejects.toBeInstanceOf(ApiError);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    const [err, ctx] = reportSpy.mock.calls[0] ?? [];
    expect(String(err)).toContain("500");
    expect(ctx?.key).toBe("api:GET:/api/routines:500");
  });

  it("reports a 401 that carried a session token — the config-mismatch signature", async () => {
    respond(401, { error: "unauthenticated" });
    await expect(
      apiPost("/api/routines", "valid-looking-token", { title: "x", dance: "waltz" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[1]?.key).toBe("api:authed-401");
  });

  it("does NOT report a 401 without a token (a signed-out caller is normal)", async () => {
    respond(401);
    await expect(apiGet("/api/routines", null)).rejects.toBeInstanceOf(ApiError);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("does NOT report product-flow refusals (402 quota, 403 forbidden)", async () => {
    respond(402, { upsell: true });
    await expect(apiPost("/api/routines", "tok", {})).rejects.toBeInstanceOf(ApiError);
    respond(403);
    await expect(apiGet("/api/routines/x", "tok")).rejects.toBeInstanceOf(ApiError);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("reports a network failure (fetch threw while the browser is online) and rethrows", async () => {
    const boom = new TypeError("Failed to fetch");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw boom;
      }),
    );
    await expect(apiPost("/api/routines", "tok", {})).rejects.toBe(boom);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[1]?.key).toBe("api:network:POST:/api/routines");
  });
});

// Spotty-network resilience: GETs (idempotent by definition) transparently retry
// TRANSIENT failures — a network throw, a request timeout, or a gateway-class
// 502/503/504 — with a short backoff, so one dropped packet on a train ride
// doesn't surface as a broken screen. Everything else stays a single attempt:
// mutations (a retried POST that DID reach the server is a double-create),
// product refusals (4xx), and a 500 (a server bug, not a blip). A recovered
// blip is silent — Sentry hears only the FINAL failure.
describe("rpc transient-failure retry (GETs only)", () => {
  const fastRetry = { retryDelaysMs: [1, 1] };

  it("retries a GET past a network throw and succeeds silently", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiGet("/api/routines", "tok", fastRetry)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportSpy).not.toHaveBeenCalled(); // healed — not an incident
  });

  it("retries a GET past a transient 503 and succeeds silently", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiGet("/api/routines", "tok", fastRetry)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("gives up after exhausting the delays, reporting the failure ONCE", async () => {
    const boom = new TypeError("Failed to fetch");
    const fetchMock = vi.fn().mockRejectedValue(boom);
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiGet("/api/routines", "tok", fastRetry)).rejects.toBe(boom);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + one per delay
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[1]?.key).toBe("api:network:GET:/api/routines");
  });

  it("does NOT retry a product refusal (403) — one attempt, immediate throw", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiGet("/api/routines/x", "tok", fastRetry)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a 500 (a server bug is not a blip)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiGet("/api/routines", "tok", fastRetry)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries mutations — a re-sent POST/DELETE that DID land is a double-write", async () => {
    const boom = new TypeError("Failed to fetch");
    const fetchMock = vi.fn().mockRejectedValue(boom);
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiPost("/api/routines", "tok", {}, fastRetry)).rejects.toBe(boom);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(apiDelete("/api/bookmarks", "tok", { ref: "x" }, fastRetry)).rejects.toBe(boom);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry while the browser says it's offline — fail fast to the offline state", async () => {
    const onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    try {
      const boom = new TypeError("Failed to fetch");
      const fetchMock = vi.fn().mockRejectedValue(boom);
      vi.stubGlobal("fetch", fetchMock);
      await expect(apiGet("/api/routines", "tok", fastRetry)).rejects.toBe(boom);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(reportSpy).not.toHaveBeenCalled(); // offline throws are expected, not incidents
    } finally {
      onLine.mockRestore();
    }
  });
});

// A request into a network black hole (sent, no answer, no RST — THE spotty-
// network failure mode) must not hang forever: every request carries a timeout.
describe("rpc request timeout", () => {
  /** A fetch that never settles until its AbortSignal fires. */
  function hangingFetch(): ReturnType<typeof vi.fn> {
    return vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
  }

  it("aborts a hung GET after timeoutMs and throws ApiTimeoutError", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      apiGet("/api/routines", "tok", { timeoutMs: 10, retryDelaysMs: [] }),
    ).rejects.toBeInstanceOf(ApiTimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reportSpy).toHaveBeenCalledTimes(1); // a timeout online is network-class
  });

  it("a timed-out GET is retried like any transient failure", async () => {
    // First attempt hangs until aborted; the retry succeeds.
    const hang = (_path: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(hang)
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      apiGet("/api/routines", "tok", { timeoutMs: 10, retryDelaysMs: [1] }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("aborts a hung POST too (single attempt, reported)", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiPost("/api/routines", "tok", {}, { timeoutMs: 10 })).rejects.toBeInstanceOf(
      ApiTimeoutError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[1]?.key).toBe("api:network:POST:/api/routines");
  });
});

// #275 — an authed 401 on an idempotent GET is USUALLY a token-expiry race on
// the 20s snapshot poll (a token used just past `exp`), NOT the Clerk instance
// mismatch the reporter warns about. Before reporting, a GET that carried a
// token retries ONCE with a force-refreshed token (`refreshToken`, the Clerk
// skipCache path). A refreshed token that verifies → the caller gets the data
// and nothing is reported; a refreshed token that STILL 401s → the failure is
// real, reported once. GETs only (retrying is safe); a mutation never retries.
describe("rpc authed-401 fresh-token retry (#275)", () => {
  it("a GET 401 → fresh-token retry SUCCEEDS: caller gets data, nothing reported", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }),
      )
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshToken = vi.fn(async () => "fresh-token");

    await expect(
      apiGet("/api/routines/x/snapshot", "stale-token", { retryDelaysMs: [], refreshToken }),
    ).resolves.toEqual({ ok: true });

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The retry carried the FRESH token, not the stale one.
    expect(authHeaderOf(fetchMock, 1)).toBe("Bearer fresh-token");
    expect(reportSpy).not.toHaveBeenCalled(); // a healed expiry race is not an incident
  });

  it("a GET 401 → fresh-token retry STILL 401s: reported once as authed-401", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const refreshToken = vi.fn(async () => "fresh-but-still-rejected");

    await expect(
      apiGet("/api/routines/x/snapshot", "stale-token", { retryDelaysMs: [], refreshToken }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[1]?.key).toBe("api:authed-401");
  });

  it("does NOT refresh-retry a 401 that carried no token (signed-out is normal)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshToken = vi.fn(async () => "fresh");

    await expect(
      apiGet("/api/routines", null, { retryDelaysMs: [], refreshToken }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(refreshToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("does NOT refresh-retry a mutation 401 — a re-sent POST is not idempotent", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshToken = vi.fn(async () => "fresh");

    await expect(
      apiPost("/api/routines", "stale", { title: "x" }, { refreshToken }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(refreshToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1); // single attempt
    expect(reportSpy).toHaveBeenCalledTimes(1); // still reported (a real authed-401)
    expect(reportSpy.mock.calls[0]?.[1]?.key).toBe("api:authed-401");
  });

  it("reports normally when no refreshToken is wired (behaviour unchanged for other callers)", async () => {
    respond(401, { error: "unauthenticated" });
    await expect(apiGet("/api/routines", "tok")).rejects.toBeInstanceOf(ApiError);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[1]?.key).toBe("api:authed-401");
  });

  it("a refreshToken that yields null falls through to a single reported 401", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const refreshToken = vi.fn(async () => null); // session gone

    await expect(
      apiGet("/api/routines/x/snapshot", "stale-token", { retryDelaysMs: [], refreshToken }),
    ).rejects.toBeInstanceOf(ApiError);

    // A null refresh means there is no fresher token to try — don't re-fire the
    // identical stale-token request; report the original 401 once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[1]?.key).toBe("api:authed-401");
  });
});

// #276 — 'Failed to fetch' bursts are the BROWSER tearing down in-flight requests
// as the page navigates/unloads, not an online transport failure. When the page
// is being torn down (pagehide / hidden) OR the throw is a deliberate abort, the
// network-throw report is suppressed. A genuine transport failure with a live,
// visible page still reports.
describe("rpc network-throw reporting: teardown vs genuine failure (#276)", () => {
  it("does NOT report a genuine-looking throw once the page is being torn down", async () => {
    const boom = new TypeError("Failed to fetch");
    const fetchMock = vi.fn(async () => {
      throw boom;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      apiGet("/api/routines/x/snapshot", "tok", { retryDelaysMs: [], pageAlive: () => false }),
    ).rejects.toBe(boom);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("does NOT report a deliberate AbortError (browser cancelled an in-flight request)", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const fetchMock = vi.fn(async () => {
      throw abort;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      apiGet("/api/routines/x/snapshot", "tok", { retryDelaysMs: [], pageAlive: () => true }),
    ).rejects.toBe(abort);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("DOES report a genuine transport failure while the page is alive", async () => {
    const boom = new TypeError("Failed to fetch");
    const fetchMock = vi.fn(async () => {
      throw boom;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      apiGet("/api/routines/x/snapshot", "tok", { retryDelaysMs: [], pageAlive: () => true }),
    ).rejects.toBe(boom);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]?.[1]?.key).toBe("api:network:GET:/api/routines/x/snapshot");
  });
});

// The TanStack Query layer's default retry is status-blind — it re-fires 401/402/
// 403 product refusals three times before surfacing them. shouldRetryQuery is the
// app-wide default (wired in main.tsx): refusals fail fast, genuinely ambiguous
// failures get a bounded second chance.
describe("shouldRetryQuery (TanStack Query default)", () => {
  it("never retries a 4xx product refusal", () => {
    expect(shouldRetryQuery(0, new ApiError(403, null))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(402, { upsell: true }))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(401, null))).toBe(false);
  });

  it("retries a network-class failure a bounded number of times", () => {
    const boom = new TypeError("Failed to fetch");
    expect(shouldRetryQuery(0, boom)).toBe(true);
    expect(shouldRetryQuery(1, boom)).toBe(true);
    expect(shouldRetryQuery(2, boom)).toBe(false);
  });

  it("retries a 5xx (ambiguous — the worker may recover)", () => {
    expect(shouldRetryQuery(0, new ApiError(503, null))).toBe(true);
    expect(shouldRetryQuery(2, new ApiError(503, null))).toBe(false);
  });
});
