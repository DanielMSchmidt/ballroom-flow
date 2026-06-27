// store/ seam (US-033): the user's account-variants + custom-figure list.
// Components touch ONLY the store (this) + ui — never lib/rpc directly (§3/AC-4).
// Built on the same react-query + lib/rpc pattern as store/routines.ts.
import { useQuery } from "@tanstack/react-query";
import { useAppAuth } from "../auth/app-auth";
import { apiGet } from "../lib/rpc";

/**
 * A figure owned by (or variant-of) the current user.
 * - `baseFigureRef` non-null → this is a variant of that figure.
 * - `baseFigureRef` null    → this is a custom (user-created) figure.
 * - `usedInCount`           → number of routines that include this figure.
 */
export interface MineFigure {
  docRef: string;
  title: string | null;
  figureType: string | null;
  baseFigureRef: string | null;
  usedInCount: number;
}

/**
 * Non-hook loader for "My figures" (US-033): fetches with a caller-supplied token
 * so the App screen can build a stable `useCallback`-wrapped version (avoids an
 * unstable `loadMine` identity that would cause a FigureLibrary refetch loop).
 */
export async function loadMineFigures(token: string | null): Promise<MineFigure[]> {
  return (await apiGet<{ figures: MineFigure[] }>("/api/figures/mine", token)).figures;
}

/** The viewer's account variants + custom figures, for the "My figures" tab. */
export function useMineFigures() {
  const { getToken } = useAppAuth();
  return useQuery({
    queryKey: ["figures", "mine"],
    queryFn: async () => {
      const data = await apiGet<{ figures: MineFigure[] }>("/api/figures/mine", await getToken());
      return data.figures;
    },
  });
}
