// US-049 (web half) — client-side error reporting to Sentry, dependency-free.
//
// Why this exists (2026-07-05 incident): production creation broke — the SPA's
// Clerk publishable key and the worker's CLERK_* secrets pointed at different
// Clerk instances, so every authenticated API call 401'd — and Sentry stayed
// EMPTY: the worker only reports unhandled route errors (a 401 is a handled
// response) and the web app had no reporter at all. This module is the web
// mirror of apps/worker/src/ops.ts: one HTTPS POST to the envelope endpoint,
// no SDK (@sentry/browser is ~90 KB for what is, here, a single fetch — and
// new deps need owner sign-off, CLAUDE.md §4). FAIL-OPEN: reporting must never
// take the app down, so every path swallows its own failures. Without a DSN
// (dev, tests, E2E) it's a silent no-op.
//
// Events are DEDUPED per session by `key`: the incident failure mode is every
// request failing identically — one event per class is enough signal and
// protects the Sentry quota.

export interface ErrorContext {
  /** Dedup key — at most one event per key per session. Omit to always send. */
  key?: string;
  url?: string;
  method?: string;
}

export interface ReporterDeps {
  /** Sentry DSN; absent → the reporter is a no-op (dev/test/E2E builds). */
  dsn?: string;
  /** Injectable for tests; defaults to global fetch. Typed on the narrow
   *  surface the reporter uses so a test fake needn't mirror all of `fetch`. */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Baked release id (the deploy's git SHA) — lets Sentry group by deploy. */
  release?: string;
}

interface ParsedDsn {
  endpoint: string;
  publicKey: string;
}

/** Parse a Sentry DSN (https://<key>@<host>/<projectId>) into its envelope endpoint. */
function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!u.username || !projectId) return null;
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      publicKey: u.username,
    };
  } catch {
    return null;
  }
}

export interface ErrorReporter {
  report(error: unknown, ctx?: ErrorContext): void;
}

export function createErrorReporter(deps: ReporterDeps = {}): ErrorReporter {
  const parsed = deps.dsn ? parseDsn(deps.dsn) : null;
  const fetchFn = deps.fetchFn ?? fetch;
  const seen = new Set<string>();

  return {
    report(error: unknown, ctx?: ErrorContext): void {
      if (!parsed) return;
      if (ctx?.key) {
        if (seen.has(ctx.key)) return;
        seen.add(ctx.key);
      }
      const err = error instanceof Error ? error : new Error(String(error));
      const eventId = crypto.randomUUID().replaceAll("-", "");
      const sentAt = new Date().toISOString();
      const event = {
        event_id: eventId,
        timestamp: sentAt,
        platform: "javascript",
        level: "error",
        ...(deps.release ? { release: deps.release } : {}),
        exception: { values: [{ type: err.name, value: err.message }] },
        ...(ctx?.url ? { request: { url: ctx.url, method: ctx.method } } : {}),
      };
      const envelope = [
        JSON.stringify({ event_id: eventId, sent_at: sentAt }),
        JSON.stringify({ type: "event" }),
        JSON.stringify(event),
      ].join("\n");
      try {
        // keepalive: the create-failure case can race a navigation away.
        void fetchFn(parsed.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-sentry-envelope",
            "x-sentry-auth": `Sentry sentry_version=7, sentry_client=weave-steps-web/1.0, sentry_key=${parsed.publicKey}`,
          },
          body: envelope,
          keepalive: true,
        }).catch(() => {
          // fail-open: never let reporting produce its own error cascade.
        });
      } catch {
        // fetch itself threw synchronously (jsdom/edge cases) — swallow.
      }
    },
  };
}

/** The narrow event-target surface `wireGlobalErrorHandlers` needs (testable). */
export interface ErrorEventTarget {
  addEventListener(type: string, listener: (e: Event) => void): void;
}

/**
 * Attach window-level last-resort handlers: uncaught exceptions and unhandled
 * promise rejections. Keyed by the error message so a render-loop crash can't
 * flood the project.
 */
export function wireGlobalErrorHandlers(
  report: (error: unknown, ctx?: ErrorContext) => void,
  target: ErrorEventTarget = window,
): void {
  // Best-effort `.message` off an unknown thrown value (Error or Error-like).
  const messageOf = (x: unknown): unknown =>
    typeof x === "object" && x !== null && "message" in x ? x.message : undefined;
  target.addEventListener("error", (e) => {
    // The listener is typed on the narrow Event surface; probe the ErrorEvent
    // fields structurally so a bare Event still reports (as before).
    const err = ("error" in e ? e.error : undefined) ?? ("message" in e ? e.message : undefined);
    report(err, { key: `uncaught:${String(messageOf(err) ?? err)}` });
  });
  target.addEventListener("unhandledrejection", (e) => {
    const reason = "reason" in e ? e.reason : undefined;
    report(reason, { key: `unhandled:${String(messageOf(reason) ?? reason)}` });
  });
}

/** The app-wide singleton, configured from the build env (no-op without a DSN). */
const appReporter = createErrorReporter({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: import.meta.env.VITE_BUILD_ID,
});

/** Report an error through the app-wide reporter (fire-and-forget, deduped by ctx.key). */
export function reportError(error: unknown, ctx?: ErrorContext): void {
  appReporter.report(error, ctx);
}

/** Wire the global handlers to the app-wide reporter — called once from main.tsx. */
export function initErrorReporting(): void {
  wireGlobalErrorHandlers(reportError);
}
