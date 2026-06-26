// store/ seam (US-032/033): the figure-library reads. Components touch ONLY the
// store (this) + ui — never lib/rpc directly (§3). Same react-query + lib/rpc
// pattern as store/routines.ts.

import type { FigureList } from "@ballroom/contract";
import type { DanceId } from "@ballroom/domain";
import { useQuery } from "@tanstack/react-query";
import { useAppAuth } from "../auth/app-auth";
import { apiGet } from "../lib/rpc";

/** The application-global figure library (US-032), optionally dance-filtered. */
export function useGlobalFigures(dance?: DanceId) {
  const { getToken } = useAppAuth();
  const qs = dance ? `?dance=${encodeURIComponent(dance)}` : "";
  return useQuery({
    queryKey: ["figures", "global", dance ?? "all"],
    queryFn: async () => apiGet<FigureList>(`/api/figures${qs}`, await getToken()),
  });
}

/** The viewer's account variants + custom figures with "used in N routines" (US-033). */
export function useMyFigures() {
  const { getToken } = useAppAuth();
  return useQuery({
    queryKey: ["figures", "mine"],
    queryFn: async () => apiGet<FigureList>("/api/figures/mine", await getToken()),
  });
}
