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

/** `fetch` that reports network throws and non-2xx classes via {@link reportApiFailure},
 *  then rethrows/returns exactly what the caller saw before reporting existed. */
async function reportingFetch(
  method: string,
  path: string,
  token: string | null,
  init: RequestInit,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (thrown) {
    reportApiFailure(method, path, { thrown }, token != null);
    throw thrown;
  }
  if (!res.ok) reportApiFailure(method, path, { status: res.status }, token != null);
  return res;
}

export async function apiGet<T>(path: string, token: string | null): Promise<T> {
  const res = await reportingFetch("GET", path, token, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, await readBody(res), `GET ${path} -> ${res.status}`);
  return readJson<T>(res);
}

/** Typed POST. Throws an {@link ApiError} (carrying status + parsed body) on non-2xx
 *  so callers can branch on e.g. a 402 quota upsell payload (#176). */
export async function apiPost<T>(path: string, token: string | null, body: unknown): Promise<T> {
  const res = await reportingFetch("POST", path, token, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await readBody(res), `POST ${path} -> ${res.status}`);
  return readJson<T>(res);
}

/** Typed DELETE. Throws an {@link ApiError} on non-2xx. `body`, when given, is
 *  JSON-encoded and sent as the DELETE payload (e.g. un-bookmark: a figureRef can
 *  contain `/`/`:`, so it rides in the body rather than a path param). */
export async function apiDelete<T>(path: string, token: string | null, body?: unknown): Promise<T> {
  const res = await reportingFetch("DELETE", path, token, {
    method: "DELETE",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok)
    throw new ApiError(res.status, await readBody(res), `DELETE ${path} -> ${res.status}`);
  return readJson<T>(res);
}
