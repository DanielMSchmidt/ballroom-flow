// store/ seam (US-025): the Choreo list read + the create mutation. Components
// touch ONLY the store (this) + ui — never lib/rpc directly (§3/AC-4). Built on
// the same react-query + lib/rpc pattern as store/me.ts.
import type { CreateRoutine, RoutineList } from "@ballroom/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppAuth } from "../auth/app-auth";
import { apiGet, apiPost } from "../lib/rpc";

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
