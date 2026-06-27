// US-045/US-046 — search + templates REST helpers.
//
// Mirrors the family-notes.ts pattern: thin wrappers around apiGet/apiPost that
// components never call directly (they go through the store seam).
import type { SearchResults, TemplateList } from "@ballroom/contract";
import { zSearchResults, zTemplateList } from "@ballroom/contract";
import type { DanceId } from "@ballroom/domain";
import { apiGet, apiPost } from "../lib/rpc";

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

/** List all app-owned template routines (US-045). */
export async function listTemplates(token: string | null, baseUrl = ""): Promise<TemplateList> {
  const raw = await apiGet<unknown>(`${baseUrl}/api/templates`, token);
  return zTemplateList.parse(raw);
}

/** Fork a template into a new owned routine (US-045). */
export async function forkTemplate(
  token: string | null,
  docRef: string,
  baseUrl = "",
): Promise<{ docRef: string }> {
  return apiPost<{ docRef: string }>(
    `${baseUrl}/api/routines/${encodeURIComponent(docRef)}/fork`,
    token,
    {},
  );
}
