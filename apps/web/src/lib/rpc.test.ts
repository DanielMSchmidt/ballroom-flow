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
