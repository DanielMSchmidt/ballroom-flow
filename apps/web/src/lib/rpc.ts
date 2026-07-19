/**
 * Thin typed fetch wrapper for the Worker API.
 *
 * IMPORTANT: imported ONLY by `store/` — components never import this directly
 * (the store/ seam is what a future offline/CRDT engine replaces). Upgraded to
 * the Hono RPC (`hc`) typed client in Milestone 2 once real routes exist.
 */

import { reportError } from "./ops";

/**
 * A non-2xx API response, surfaced with its `status` (and parsed `body` when JSON)
 * so a store/ caller can branch on it — e.g. a 403 access check → the denied state
 * (FE-2 / #178), or a 402 quota → the upsell with the server-provided cap (#176).
 * Plain `Error` only carried a message string, which forced callers to string-match
 * the status; this keeps the branch honest.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
    this.name = "ApiError";
  }
}

/**
 * A request that hit its deadline without the server answering — the network
 * black hole (sent, no reply, no RST) that a spotty connection produces and
 * that a bare `fetch` would wait on forever. Callers treat it like any other
 * network throw (it is one, just bounded); it exists as a class so the message
 * carries the deadline and retry logic can recognize it as transient.
 */
export class ApiTimeoutError extends Error {
  constructor(method: string, path: string, timeoutMs: number) {
    super(`${method} ${path} timed out after ${timeoutMs}ms`);
    this.name = "ApiTimeoutError";
  }
}

/** Per-request resilience knobs; production callers use the defaults. */
export interface RequestOptions {
  /** Abort the request after this many ms (default {@link DEFAULT_TIMEOUT_MS}). */
  timeoutMs?: number;
  /**
   * Backoff delays (ms) between transient-failure retries — GETs only; one
   * retry per entry, jittered. `[]` disables retry. Mutations ignore this:
   * a re-sent POST/DELETE that DID reach the server is a double-write.
   */
  retryDelaysMs?: number[];
}

/** Generous enough for a slow mobile uplink, short enough that the UI's
 *  error/offline affordances take over instead of an indefinite spinner. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Two quick retries — rides out a dropped packet or a DO cold start without
 *  meaningfully delaying the honest failure state when the network is truly gone. */
const DEFAULT_RETRY_DELAYS_MS = [500, 1500];
/** Gateway-class statuses: the edge answered but the worker/DO didn't — the only
 *  response statuses worth a retry. A 500 is a server bug, not a blip. */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

const browserOnline = (): boolean => (typeof navigator === "undefined" ? true : navigator.onLine);

/**
 * Default TanStack Query retry predicate (wired app-wide in `main.tsx`).
 * The library default is status-blind — it re-fired 401/402/403 product
 * refusals three times before surfacing them (the "retry storm" ChoreoFlow
 * once re-rendered under). Refusals fail fast; ambiguous failures (network,
 * 5xx) get a bounded second chance on top of the rpc-layer transient retry.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/** Parse a response body as JSON, tolerating an empty/non-JSON body (→ null). */
async function readBody(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/**
 * Read a 2xx body under the caller's declared response type. This is the ONE
 * fetch→type boundary for the REST surface: `Response.json()` is `any` in
 * lib.dom, and what actually guarantees the shape at runtime is the worker
 * contract (`@weavesteps/contract` schemas validate on the server side of the
 * same route) — the type system can't see across the wire, so the caller's `T`
 * is that contract's claim, stated here once instead of asserted per call site.
 */
async function readJson<T>(res: Response): Promise<T> {
  return res.json();
}

/**
 * Report an UNEXPECTED API failure (US-049 web half, 2026-07-05 incident):
 * 5xx (the server broke), a 401 that carried a session token (a signed-in user
 * rejected — the Clerk config-mismatch signature that broke production create),
 * or a network throw while the browser believes it's online. Product-flow
 * refusals (402 quota, 403, signed-out 401) are NOT errors. Deduped per
 * session via the ctx key; never changes what the caller sees.
 */
function reportApiFailure(
  method: string,
  path: string,
  outcome: { status: number } | { thrown: unknown },
  hadToken: boolean,
): void {
  if ("status" in outcome) {
    const { status } = outcome;
    if (status >= 500) {
      reportError(new Error(`${method} ${path} -> ${status}`), {
        key: `api:${method}:${path}:${status}`,
        url: path,
        method,
      });
    } else if (status === 401 && hadToken) {
      reportError(
        new Error(
          `${method} ${path} -> 401 despite a session token — are the SPA's Clerk publishable key and the worker's CLERK_* secrets the same Clerk instance? (PROVISIONING.md)`,
        ),
        { key: "api:authed-401", url: path, method },
      );
    }
  } else if (typeof navigator === "undefined" || navigator.onLine) {
    const e = outcome.thrown;
    reportError(e instanceof Error ? e : new Error(String(e)), {
      key: `api:network:${method}:${path}`,
      url: path,
      method,
    });
  }
}

/** One `fetch` attempt under a deadline. On the deadline firing, the request is
 *  aborted and an {@link ApiTimeoutError} thrown; any other throw passes through. */
async function fetchWithTimeout(
  method: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } catch (thrown) {
    if (controller.signal.aborted) throw new ApiTimeoutError(method, path, timeoutMs);
    throw thrown;
  } finally {
    clearTimeout(deadline);
  }
}

/** Jittered pause between retry attempts (±25% spread so concurrent callers
 *  hitting the same blip don't re-fire in lockstep). */
function retryPause(baseMs: number): Promise<void> {
  const ms = baseMs * (0.75 + Math.random() * 0.5);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `fetch` with the resilience policy (spotty networks, 2026-07-13):
 * every attempt runs under a timeout, and — for GETs only — a TRANSIENT
 * failure (network throw, timeout, 502/503/504 gateway answer) is retried
 * per `retryDelaysMs` before surfacing. Retries are skipped while the
 * browser reports offline: failing fast into the offline UI state is more
 * honest than burning the backoff against a network that isn't there.
 * Reporting fires only on the FINAL outcome ({@link reportApiFailure}), so a
 * healed blip is silent; what the caller ultimately sees (return / throw) is
 * exactly what a bare fetch would have shown them.
 */
async function resilientFetch(
  method: string,
  path: string,
  token: string | null,
  init: RequestInit,
  opts?: RequestOptions,
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const delays = method === "GET" ? (opts?.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS) : [];
  for (let attempt = 0; ; attempt += 1) {
    const delay = delays[attempt];
    const mayRetry = delay !== undefined && browserOnline();
    try {
      const res = await fetchWithTimeout(method, path, init, timeoutMs);
      if (!res.ok && TRANSIENT_STATUSES.has(res.status) && mayRetry) {
        await retryPause(delay);
        continue;
      }
      if (!res.ok) reportApiFailure(method, path, { status: res.status }, token != null);
      return res;
    } catch (thrown) {
      if (mayRetry) {
        await retryPause(delay);
        continue;
      }
      reportApiFailure(method, path, { thrown }, token != null);
      throw thrown;
    }
  }
}

export async function apiGet<T>(
  path: string,
  token: string | null,
  opts?: RequestOptions,
): Promise<T> {
  const res = await resilientFetch(
    "GET",
    path,
    token,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    opts,
  );
  if (!res.ok) throw new ApiError(res.status, await readBody(res), `GET ${path} -> ${res.status}`);
  return readJson<T>(res);
}

/** Typed POST. Throws an {@link ApiError} (carrying status + parsed body) on non-2xx
 *  so callers can branch on e.g. a 402 quota upsell payload (#176). */
export async function apiPost<T>(
  path: string,
  token: string | null,
  body: unknown,
  opts?: RequestOptions,
): Promise<T> {
  const res = await resilientFetch(
    "POST",
    path,
    token,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    },
    opts,
  );
  if (!res.ok) throw new ApiError(res.status, await readBody(res), `POST ${path} -> ${res.status}`);
  return readJson<T>(res);
}

/**
 * PUT a raw binary body (the media-upload arm, docs/ideas/annotation-media-embeds.md).
 * A single R2 PUT through the worker — the blob rides as the request body under the
 * caller's `content-type`. Like every mutation this NEVER retries (a re-sent PUT that
 * reached R2 is a double-write); throws an {@link ApiError} on non-2xx. No JSON body
 * is returned (an object PUT answers empty), so this resolves `void`.
 */
export async function apiPutBlob(
  path: string,
  token: string | null,
  blob: Blob,
  contentType: string,
): Promise<void> {
  const res = await resilientFetch("PUT", path, token, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: blob,
  });
  if (!res.ok) throw new ApiError(res.status, await readBody(res), `PUT ${path} -> ${res.status}`);
}

/**
 * PUT a raw binary body and read a JSON response (the multipart upload-part arm:
 * the worker answers each part PUT with `{ partNumber, etag }`). Same no-retry
 * mutation policy as {@link apiPutBlob}; throws an {@link ApiError} on non-2xx.
 */
export async function apiPutBlobJson<T>(
  path: string,
  token: string | null,
  blob: Blob,
  contentType: string,
): Promise<T> {
  const res = await resilientFetch("PUT", path, token, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: blob,
  });
  if (!res.ok) throw new ApiError(res.status, await readBody(res), `PUT ${path} -> ${res.status}`);
  return readJson<T>(res);
}

/** Typed DELETE. Throws an {@link ApiError} on non-2xx. `body`, when given, is
 *  JSON-encoded and sent as the DELETE payload (e.g. un-bookmark: a figureRef can
 *  contain `/`/`:`, so it rides in the body rather than a path param). */
export async function apiDelete<T>(
  path: string,
  token: string | null,
  body?: unknown,
  opts?: RequestOptions,
): Promise<T> {
  const res = await resilientFetch(
    "DELETE",
    path,
    token,
    {
      method: "DELETE",
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    opts,
  );
  if (!res.ok)
    throw new ApiError(res.status, await readBody(res), `DELETE ${path} -> ${res.status}`);
  return readJson<T>(res);
}
