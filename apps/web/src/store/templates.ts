// US-045 — template list + template-fork REST helpers.
//
// Mirrors the family-notes.ts pattern: thin wrappers around apiGet/apiPost that
// components never call directly (they go through the store seam).
import type { TemplateList } from "@weavesteps/contract";
import { zTemplateList } from "@weavesteps/contract";
import { apiGet, apiPost } from "../lib/rpc";

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
