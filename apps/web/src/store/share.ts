// store/ seam (US-024 Share screen). Components touch ONLY the store + ui — never
// lib/rpc directly (§3). Wraps the worker Share REST surface: the member roster,
// remove-member (soft-delete), and issue-invite (reuses the US-023 endpoint).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IssueInvite } from "@weavesteps/contract";
import { useAppAuth } from "../auth/app-auth";
import { apiDelete, apiGet, apiPost } from "../lib/rpc";

/** A stored membership role (never "owner" — ownership isn't a membership row). */
export type StoredRole = "editor" | "commenter" | "viewer";

/** The document owner's identity, as returned by GET /api/docs/:id/members. */
export interface OwnerInfo {
  userId: string;
  identityColor?: string;
  displayName?: string;
}

/** One member of a document, as the Share roster shows them.
 *  T8: `identityColor` + `displayName` are included when available (the server
 *  joins `users` on the members query) so annotation threads can resolve real
 *  identity colours without a separate fetch. */
export interface Member {
  userId: string;
  role: StoredRole;
  /** The member's stored identity colour hex (e.g. "#3b7dd8"). */
  identityColor?: string;
  /** The member's display name. */
  displayName?: string;
}

interface MembersResponse {
  members: Member[];
  owner?: OwnerInfo | null;
}

/** The document's member roster + roles (US-024 AC-1). Any member may read it. */
export function useMembers(docRef: string) {
  const { getToken } = useAppAuth();
  return useQuery({
    queryKey: ["members", docRef],
    queryFn: async () =>
      apiGet<MembersResponse>(`/api/docs/${encodeURIComponent(docRef)}/members`, await getToken()),
  });
}

/** Remove a member (US-024 AC-2): soft-delete server-side; refetch the roster. */
export function useRemoveMember(docRef: string) {
  const { getToken } = useAppAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) =>
      apiDelete<{ ok: true }>(
        `/api/docs/${encodeURIComponent(docRef)}/members/${encodeURIComponent(userId)}`,
        await getToken(),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", docRef] }),
  });
}

/** The result of issuing a shareable invite link (US-023). */
export interface IssuedInvite {
  token: string;
  role: StoredRole;
  expiresAt: number;
}

/** Issue a shareable invite for a role (US-023 AC-1) — editor/owner only (server-gated). */
export function useIssueInvite(docRef: string) {
  const { getToken } = useAppAuth();
  return useMutation({
    mutationFn: async (input: IssueInvite) =>
      apiPost<IssuedInvite>(
        `/api/docs/${encodeURIComponent(docRef)}/invites`,
        await getToken(),
        input,
      ),
  });
}
