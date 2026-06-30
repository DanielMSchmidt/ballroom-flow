/**
 * Thin typed fetch wrapper for the Worker API.
 *
 * IMPORTANT: imported ONLY by `store/` — components never import this directly
 * (the store/ seam is what a future offline/CRDT engine replaces). Upgraded to
 * the Hono RPC (`hc`) typed client in Milestone 2 once real routes exist.
 */

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

export async function apiGet<T>(path: string, token: string | null): Promise<T> {
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, await readBody(res), `GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** Typed POST. Throws an {@link ApiError} (carrying status + parsed body) on non-2xx
 *  so callers can branch on e.g. a 402 quota upsell payload (#176). */
export async function apiPost<T>(path: string, token: string | null, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await readBody(res), `POST ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** Typed DELETE. Throws an {@link ApiError} on non-2xx. */
export async function apiDelete<T>(path: string, token: string | null): Promise<T> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok)
    throw new ApiError(res.status, await readBody(res), `DELETE ${path} -> ${res.status}`);
  return (await res.json()) as T;
}
