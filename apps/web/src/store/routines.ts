// store/ seam (US-025): the Choreo list read + the create mutation. Components
// touch ONLY the store (this) + ui — never lib/rpc directly (§3/AC-4). Built on
// the same react-query + lib/rpc pattern as store/me.ts.
import type { CreateRoutine, RoutineList } from "@ballroom/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppAuth } from "../auth/app-auth";
import { ApiError, apiGet, apiPost } from "../lib/rpc";

/** Whether a create failure is the server's quota refusal (402) — drives the
 *  upsell. Lives in the store so components branch on it without importing
 *  lib/rpc directly (the §3 boundary, enforced by routine-store.test.ts). */
export function isQuotaError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402;
}

/** The viewer's routines (owned + shared-in) for the Choreo list. */
export function useRoutines() {
  const { getToken } = useAppAuth();
  return useQuery({
    queryKey: ["routines"],
    queryFn: async () => apiGet<RoutineList>("/api/routines", await getToken()),
  });
}

/** Create a routine; on success the list refetches so the new one appears. */
export function useCreateRoutine() {
  const { getToken } = useAppAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRoutine) =>
      apiPost<{ docRef: string }>("/api/routines", await getToken(), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routines"] }),
  });
}

/**
 * Fork a routine ("make it your own", US-037): the server clones it into a NEW
 * OWNED, frozen copy and returns its docRef. On success the list refetches so the
 * fork appears. Quota-checked server-side (402 → isQuotaError, same as create).
 */
export function useForkRoutine() {
  const { getToken } = useAppAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (originRef: string) =>
      apiPost<{ docRef: string; forkedFromRef: string }>(
        `/api/routines/${encodeURIComponent(originRef)}/fork`,
        await getToken(),
        {},
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routines"] }),
  });
}
