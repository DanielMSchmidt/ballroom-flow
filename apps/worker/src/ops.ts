// US-049 — Ops seam (M8): errors→Sentry, product metrics→Analytics Engine.
//
// Deliberately dependency-free: Sentry ingestion is one HTTPS POST to the
// envelope endpoint, so we speak the wire format directly instead of adding
// @sentry/cloudflare (new deps need owner sign-off — CLAUDE.md §4; the SDK adds
// ~100 KB for what is, on Workers, a single fetch). Both sinks are FAIL-OPEN:
// observability must never take a request down, so every path here swallows its
// own failures. With no DSN / no AE binding (local dev, tests) both are no-ops.

/** The slice of the worker Env the ops seam reads — kept narrow for tests. */
export interface OpsEnv {
  SENTRY_DSN?: string;
}

/** Structural AE binding type so tests can capture writes with a plain object. */
export interface MetricSink {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface RequestContext {
  url?: string;
  method?: string;
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

/**
 * Report an error to Sentry via the envelope API (US-049 AC-1). No-op without
 * SENTRY_DSN. Never throws — callers may fire-and-forget or waitUntil it.
 */
export async function reportError(
  env: OpsEnv,
  error: unknown,
  ctx?: RequestContext,
): Promise<void> {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return;
  const parsed = parseDsn(dsn);
  if (!parsed) return;

  const err = error instanceof Error ? error : new Error(String(error));
  const eventId = crypto.randomUUID().replaceAll("-", "");
  const sentAt = new Date().toISOString();
  const event = {
    event_id: eventId,
    timestamp: sentAt,
    platform: "javascript",
    level: "error",
    exception: {
      values: [
        {
          type: err.name,
          value: err.message,
          ...(err.stack
            ? { stacktrace: { frames: [{ function: err.stack.split("\n", 2)[1]?.trim() ?? "?" }] } }
            : {}),
        },
      ],
    },
    ...(ctx?.url ? { request: { url: ctx.url, method: ctx.method } } : {}),
  };
  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: sentAt }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");

  try {
    await fetch(parsed.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_client=weave-steps/1.0, sentry_key=${parsed.publicKey}`,
      },
      body: envelope,
    });
  } catch (e) {
    console.error("sentry report failed", e);
  }
}

/**
 * Emit a product metric to Analytics Engine (US-049 AC-1). The metric name is
 * always blob[0] so one dataset serves many metrics. No-op without a binding;
 * never throws. NOTE: no `indexes` by default — AE allows one low-cardinality
 * index and request paths carry ULIDs, so callers opt in explicitly.
 */
export function writeMetric(
  sink: MetricSink | undefined,
  metric: { name: string; blobs?: string[]; doubles?: number[]; index?: string },
): void {
  if (!sink) return;
  try {
    sink.writeDataPoint({
      blobs: [metric.name, ...(metric.blobs ?? [])],
      doubles: metric.doubles ?? [],
      ...(metric.index ? { indexes: [metric.index] } : {}),
    });
  } catch (e) {
    console.error("analytics write failed", e);
  }
}
