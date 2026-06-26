// store/ seam (US-023): redeem an invite link. Components touch ONLY the store +
// ui — never lib/rpc directly (§3). On success the routines list refetches so
// the just-joined routine appears.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppAuth } from "../auth/app-auth";
import { apiPost } from "../lib/rpc";

export interface RedeemResult {
  docRef: string;
  role: "viewer" | "commenter" | "editor";
}

/** Redeem an invite token; grants membership server-side and returns the doc + role. */
export function useRedeemInvite() {
  const { getToken } = useAppAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) =>
      apiPost<RedeemResult>(
        `/api/invites/${encodeURIComponent(token)}/redeem`,
        await getToken(),
        {},
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routines"] }),
  });
}
