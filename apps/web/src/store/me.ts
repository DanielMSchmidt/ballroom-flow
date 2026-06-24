import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/rpc";

export type Me = { sub: string };

/** store/ seam: the current user's verified identity from the Worker. */
export function useMe() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => apiGet<Me>("/api/me", await getToken()),
  });
}
