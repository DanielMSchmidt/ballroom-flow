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
