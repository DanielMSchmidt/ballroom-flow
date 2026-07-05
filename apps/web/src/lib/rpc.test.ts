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
import { ApiError, apiGet, apiPost } from "./rpc";

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
