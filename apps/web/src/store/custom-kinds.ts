// US-043 — account-wide custom attribute kinds, REST helpers + store-seam hooks.
//
// Mirrors the family-notes.ts pattern: thin wrappers around apiGet/apiPost that
// components never call directly (they go through the routine store seam).
import { zAccountCustomKinds } from "@ballroom/contract";
import type { RegistryKind } from "@ballroom/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppAuth } from "../auth/app-auth";
import { apiGet, apiPost } from "../lib/rpc";

/** React Query key for the caller's account-wide custom kinds. */
const ACCOUNT_KINDS_KEY = ["account-custom-kinds"] as const;

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

/**
 * store/ seam: the caller's account-wide custom attribute kinds (frame 1.17).
 * A React Query read — deterministic caching + retry + a stable loading state —
 * replacing the old hand-rolled `useEffect` fetch in ProfileScreen (which was
 * best-effort and re-fired on `getToken` identity churn). Components read kinds
 * via `data ?? []` so the manager renders even before the query resolves.
 */
export function useAccountKinds() {
  const { getToken } = useAppAuth();
  return useQuery({
    queryKey: ACCOUNT_KINDS_KEY,
    queryFn: async () => listAccountKinds(await getToken()),
  });
}

/**
 * store/ seam: create/update an account-wide custom kind, then refetch the list
 * so the manager reflects the server truth (an optimistic add keeps it instant).
 */
export function useSaveAccountKind() {
  const { getToken } = useAppAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kind: RegistryKind) => saveAccountKind(await getToken(), kind),
    onMutate: async (kind: RegistryKind) => {
      await qc.cancelQueries({ queryKey: ACCOUNT_KINDS_KEY });
      const prev = qc.getQueryData<RegistryKind[]>(ACCOUNT_KINDS_KEY);
      qc.setQueryData<RegistryKind[]>(ACCOUNT_KINDS_KEY, (old = []) => [
        ...old.filter((k) => k.kind !== kind.kind),
        kind,
      ]);
      return { prev };
    },
    onError: (_err, _kind, ctx) => {
      // Roll back the optimistic add on failure.
      if (ctx?.prev) qc.setQueryData(ACCOUNT_KINDS_KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ACCOUNT_KINDS_KEY }),
  });
}
