// store/ seam (US-025): the Choreo list read + the create mutation. Components
// touch ONLY the store (this) + ui — never lib/rpc directly (§3/AC-4). Built on
// the same react-query + lib/rpc pattern as store/me.ts.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateRoutine, RoutineList } from "@weavesteps/contract";
import { useAppAuth } from "../auth/app-auth";
import { ApiError, apiDelete, apiGet, apiPost } from "../lib/rpc";
import { withOfflineCache } from "./offline";

/** Whether a create failure is the server's quota refusal (402) — drives the
 *  upsell. Lives in the store so components branch on it without importing
 *  lib/rpc directly (the §3 boundary, enforced by routine-store.test.ts). */
export function isQuotaError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402;
}

/** The viewer's routines (owned + shared-in) for the Choreo list. Offline, the
 *  last-good list serves from the on-device cache (§11.2 offline app open) —
 *  `networkMode: "always"` so the attempt (and with it the cache fallback)
 *  runs even when react-query believes the browser is offline. */
export function useRoutines() {
  const { getToken } = useAppAuth();
  return useQuery({
    queryKey: ["routines"],
    networkMode: "always",
    queryFn: async () =>
      withOfflineCache<RoutineList>("bf_routines", async () =>
        apiGet<RoutineList>("/api/routines", await getToken()),
      ),
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
 * Delete a routine from the Choreo overview (US-025 delete flow). The server
 * SOFT-deletes (tombstones) the registry row — owner-only (403 otherwise) — so it
 * drops out of the list; on success the list refetches so the card disappears.
 */
export function useDeleteRoutine() {
  const { getToken } = useAppAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (docRef: string) =>
      apiDelete<{ ok: true }>(`/api/routines/${encodeURIComponent(docRef)}`, await getToken()),
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
