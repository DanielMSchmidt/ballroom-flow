import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppAuth } from "../auth/app-auth";
import { apiGet, apiPost } from "../lib/rpc";
import { withOfflineCache } from "./offline";

export type Me = {
  sub: string;
  onboarded?: boolean;
  plan?: "free" | "pro";
  displayName?: string;
  identityColor?: string;
  /** The free-plan owned-routine cap (server source of truth, #176). */
  routineCap?: number;
};

/** store/ seam: the current user's verified identity from the Worker. Offline,
 *  the last-good response serves from the on-device cache (§11.2 offline app
 *  open) — keeps `currentUserId` (annotation authorship, undo attribution)
 *  stable when the installed app launches with no network. */
export function useMe() {
  const { getToken } = useAppAuth();
  return useQuery({
    queryKey: ["me"],
    networkMode: "always",
    queryFn: async () =>
      withOfflineCache<Me>("bf_me", async () => apiGet<Me>("/api/me", await getToken())),
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
