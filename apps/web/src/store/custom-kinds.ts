// US-043 — account-wide custom attribute kinds, REST helpers.
//
// Mirrors the family-notes.ts pattern: thin wrappers around apiGet/apiPost that
// components never call directly (they go through the routine store seam).
import { zAccountCustomKinds } from "@ballroom/contract";
import type { RegistryKind } from "@ballroom/domain";
import { apiGet, apiPost } from "../lib/rpc";

/** Fetch the caller's account-wide custom attribute kinds (US-043). */
export async function listAccountKinds(
  token: string | null,
  baseUrl = "",
): Promise<RegistryKind[]> {
  const raw = await apiGet<unknown>(`${baseUrl}/api/account/custom-kinds`, token);
  // zAccountCustomKinds validates to the same shape as the domain RegistryKind
  // (kind/label/color/cardinality/valueType/values?/freeText?/appliesToDances?/builtin),
  // so the parsed result is assignable directly — no cast needed.
  const { kinds } = zAccountCustomKinds.parse(raw);
  return kinds;
}

/** Persist a newly-created custom kind account-wide (US-043). */
export async function saveAccountKind(
  token: string | null,
  kind: RegistryKind,
  baseUrl = "",
): Promise<void> {
  await apiPost<unknown>(`${baseUrl}/api/account/custom-kinds`, token, kind);
}
