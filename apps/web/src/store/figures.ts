// store/ seam (US-033): the user's account-variants + custom-figure list.
// Components touch ONLY the store (this) + ui — never lib/rpc directly (§3/AC-4).
// Built on the same react-query + lib/rpc pattern as store/routines.ts.
import type { SaveToLibrary } from "@ballroom/contract";
import { useQuery } from "@tanstack/react-query";
import { useAppAuth } from "../auth/app-auth";
import { apiGet, apiPost } from "../lib/rpc";

/**
 * A figure owned by (or saved/copied by) the current user.
 * - `baseFigureRef` non-null → a saved/copied figure (provenance of its source).
 * - `baseFigureRef` null    → a from-scratch custom figure.
 * - `dance`                 → the figure's dance (drives the personal-library dance filter).
 * - `usedInCount`           → number of routines that reference this figure.
 */
export interface MineFigure {
  docRef: string;
  title: string | null;
  figureType: string | null;
  dance: string | null;
  baseFigureRef: string | null;
  usedInCount: number;
}

/** Result of a save-to-library promotion (idempotent: re-saving is a no-op). */
export interface SaveToLibraryResult {
  figureRef: string;
  baseFigureRef: string;
  alreadySaved: boolean;
}

/**
 * Non-hook loader for "My figures" (US-033): fetches with a caller-supplied token
 * so the App screen can build a stable `useCallback`-wrapped version (avoids an
 * unstable `loadMine` identity that would cause a FigureLibrary refetch loop).
 */
export async function loadMineFigures(token: string | null): Promise<MineFigure[]> {
  return (await apiGet<{ figures: MineFigure[] }>("/api/figures/mine", token)).figures;
}

/**
 * Promote a global-catalog figure into the caller's personal library (T5) — a
 * FROZEN account-figure copy (PLAN §5.2). Non-hook (mirrors {@link loadMineFigures})
 * so the App screen can wrap it in a stable token-bound callback. Idempotent
 * server-side: re-saving the same figure returns the existing copy.
 */
export async function saveFigureToLibrary(
  token: string | null,
  input: SaveToLibrary,
): Promise<SaveToLibraryResult> {
  return apiPost<SaveToLibraryResult>("/api/figures/save-to-library", token, input);
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
