// US-046 — search REST helper.
//
// Mirrors the family-notes.ts pattern: thin wrappers around apiGet/apiPost that
// components never call directly (they go through the store seam).
import type { SearchResults } from "@weavesteps/contract";
import { zSearchResults } from "@weavesteps/contract";
import type { DanceId } from "@weavesteps/domain";
import { apiGet } from "../lib/rpc";

/** Search routines + figures by query and optional dance filter (US-046). */
export async function search(
  token: string | null,
  q: string,
  dance?: DanceId,
  baseUrl = "",
): Promise<SearchResults> {
  let url = `${baseUrl}/api/search?q=${encodeURIComponent(q)}`;
  if (dance !== undefined) {
    url += `&dance=${encodeURIComponent(dance)}`;
  }
  const raw = await apiGet<unknown>(url, token);
  return zSearchResults.parse(raw);
}
