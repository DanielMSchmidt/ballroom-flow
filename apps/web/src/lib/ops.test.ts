// US-049 (web half, 2026-07-05 incident) — client-side error reporting.
// When production creation broke (a Clerk instance mismatch 401'd every API
// call), the web app had NO reporter: the failures were client-visible only
// and Sentry stayed empty. This module is the dependency-free web mirror of
// apps/worker/src/ops.ts — one envelope POST, fail-open, deduped per session.
import { describe, expect, it, vi } from "vitest";
import { createErrorReporter, wireGlobalErrorHandlers } from "./ops";

const DSN = "https://webkey@o123.ingest.sentry.io/789";

function capture() {
  const calls: { url: string; body: string }[] = [];
  const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response("{}");
  });
  return { calls, fetchFn: fetchFn as unknown as typeof fetch };
}

describe("createErrorReporter (US-049 web half)", () => {
  it("posts a Sentry envelope with the exception and request context", async () => {
    const { calls, fetchFn } = capture();
    const r = createErrorReporter({ dsn: DSN, fetchFn });
    r.report(new Error("create exploded"), { url: "/api/routines", method: "POST" });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]?.url).toBe("https://o123.ingest.sentry.io/api/789/envelope/");
    expect(calls[0]?.body).toContain("create exploded");
    expect(calls[0]?.body).toContain("/api/routines");
  });

  it("is a silent no-op without a DSN (dev/test/E2E builds)", () => {
    const { calls, fetchFn } = capture();
    const r = createErrorReporter({ fetchFn });
    r.report(new Error("ignored"));
    expect(calls.length).toBe(0);
  });

  it("dedupes by context key — one event per failure class per session", async () => {
    // The incident failure mode is EVERY api call failing identically; one
    // event per class is enough signal and protects the Sentry quota.
    const { calls, fetchFn } = capture();
    const r = createErrorReporter({ dsn: DSN, fetchFn });
    r.report(new Error("401 #1"), { key: "api:authed-401" });
    r.report(new Error("401 #2"), { key: "api:authed-401" });
    r.report(new Error("different class"), { key: "api:network" });
    await vi.waitFor(() => expect(calls.length).toBe(2));
  });

  it("never throws — a rejecting fetch is swallowed (observability must not take the app down)", () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const r = createErrorReporter({ dsn: DSN, fetchFn });
    expect(() => r.report(new Error("boom"))).not.toThrow();
  });

  it("wireGlobalErrorHandlers reports window 'error' and 'unhandledrejection' events", async () => {
    const reported: unknown[] = [];
    const handlers = new Map<string, (e: Event) => void>();
    const target = {
      addEventListener: (type: string, fn: (e: Event) => void) => void handlers.set(type, fn),
    };
    wireGlobalErrorHandlers((error) => void reported.push(error), target);

    handlers.get("error")?.(new ErrorEvent("error", { error: new Error("sync crash") }));
    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = new Error("async crash");
    handlers.get("unhandledrejection")?.(rejection);

    expect(reported.map((e) => (e as Error).message)).toEqual(["sync crash", "async crash"]);
  });
});
