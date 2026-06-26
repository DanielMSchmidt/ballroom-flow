/**
 * Thin typed fetch wrapper for the Worker API.
 *
 * IMPORTANT: imported ONLY by `store/` — components never import this directly
 * (the store/ seam is what a future offline/CRDT engine replaces). Upgraded to
 * the Hono RPC (`hc`) typed client in Milestone 2 once real routes exist.
 */
export async function apiGet<T>(path: string, token: string | null): Promise<T> {
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** Typed POST. Throws on non-2xx (the server-side quota 402 is pre-empted by the
 *  client cap check, so the create path here only sees success in practice). */
export async function apiPost<T>(path: string, token: string | null, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  return (await res.json()) as T;
}
