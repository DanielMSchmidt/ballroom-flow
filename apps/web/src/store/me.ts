import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppAuth } from "../auth/app-auth";
import { apiGet, apiPost } from "../lib/rpc";

export type Me = {
  sub: string;
  onboarded?: boolean;
  plan?: "free" | "pro";
  displayName?: string;
  identityColor?: string;
  /** The free-plan owned-routine cap (server source of truth, #176). */
  routineCap?: number;
};

/** store/ seam: the current user's verified identity from the Worker. */
export function useMe() {
  const { getToken } = useAppAuth();
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => apiGet<Me>("/api/me", await getToken()),
  });
}

/** Save display name + identity colour (US-053 / first-run onboarding, US-019). */
export function useOnboard() {
  const { getToken } = useAppAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { displayName: string; identityColor: string }) =>
      apiPost<Me>("/api/onboarding", await getToken(), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}
