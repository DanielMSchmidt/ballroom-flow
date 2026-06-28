import {
  type FigureView,
  fromQueryState,
  type RoutineTree,
  selectFigureView,
} from "@ballroom/domain";
import { useAuth } from "@clerk/clerk-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/rpc";
import { FIGURE_CATALOG } from "./catalog";

/**
 * store/ seam: the routine tree (sides → figures → steps), loaded via RPC.
 *
 * `placeholderData: keepPreviousData` is the Part C fix — during a refetch the
 * previous tree is retained in `data`, so figures keep resolving instead of
 * flashing a loading/unknown state. `staleTime` avoids needless refetch gaps.
 * The `/api/routines/:id` route lands in Milestone 2; the resolution seam is in
 * place now so the figure UI is built against it from the start.
 */
export function useRoutineTree(routineId: string) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["routine", routineId],
    queryFn: async () => apiGet<RoutineTree>(`/api/routines/${routineId}`, await getToken()),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/**
 * store/ seam: resolve one figure to a three-state {@link FigureView}. Components
 * render from this and never compute an "unknown figure" fallback themselves —
 * `loading` shows a skeleton, `unresolved` shows the stored name with an
 * "unrecognized" affordance, `resolved` shows the figure.
 */
export function useFigure(routineId: string, figureId: string): FigureView {
  const query = useRoutineTree(routineId);
  return selectFigureView(fromQueryState(query), figureId, FIGURE_CATALOG);
}
