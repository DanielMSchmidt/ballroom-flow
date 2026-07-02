// store/ seam (US-033): the user's LIBRARY — bookmarked figures (⟳v5, PLAN
// §4.2/§5.2/D28). Components touch ONLY the store (this) + ui — never lib/rpc
// directly (§3/AC-4). Built on the same react-query + lib/rpc pattern as
// store/routines.ts.
import type { SaveToLibrary } from "@ballroom/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppAuth } from "../auth/app-auth";
import { apiDelete, apiGet, apiPost } from "../lib/rpc";

/**
 * A figure in the current user's library — i.e. one they've BOOKMARKED (⟳v5: a
 * reference, never a copy; several users may bookmark the same figureRef).
 * - `baseFigureRef` non-null → a variant (lineage: "based on …").
 * - `baseFigureRef` null    → a from-scratch custom, OR an un-edited bookmarked
 *   catalog figure (the catalog original, not a variant of anything).
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

/** Result of a library bookmark (idempotent: re-bookmarking is a no-op). */
export interface SaveToLibraryResult {
  alreadySaved: boolean;
}

const MINE_QUERY_KEY = ["figures", "mine"] as const;

/**
 * Non-hook loader for "My figures" (US-033): fetches with a caller-supplied token
 * so the App screen can build a stable `useCallback`-wrapped version (avoids an
 * unstable `loadMine` identity that would cause a FigureLibrary refetch loop).
 */
export async function loadMineFigures(token: string | null): Promise<MineFigure[]> {
  return (await apiGet<{ figures: MineFigure[] }>("/api/figures/mine", token)).figures;
}

/**
 * Bookmark a figure into the caller's library ("↟ Save to my library" / "add to
 * my library", T5 ⟳v5) — a REFERENCE, never a copy (PLAN §4.2/§5.2/D28). Accepts
 * either the direct `{ figureRef }` shape (the account/choreo-local affordance)
 * or the legacy `(dance, figureType, name)` triple the global-catalog "↟ save"
 * card still sends (the worker resolves it to `globalFigureRef` and bookmarks
 * THAT ref — still no copy). Non-hook (mirrors {@link loadMineFigures}) so the
 * App screen can wrap it in a stable token-bound callback. Idempotent
 * server-side: re-bookmarking the same figure is a no-op (`alreadySaved: true`).
 */
export async function saveFigureToLibrary(
  token: string | null,
  input: SaveToLibrary,
): Promise<SaveToLibraryResult> {
  return apiPost<SaveToLibraryResult>("/api/figures/save-to-library", token, input);
}

/** The viewer's library — their bookmarked figures — for the "My figures" tab
 *  AND for deriving the placement-card/figure-editor bookmark state (⟳v5). `enabled`
 *  lets a caller that only needs it conditionally (e.g. an open routine) skip the
 *  fetch otherwise — mirrors `useDocAccess`'s `{ enabled }` option. */
export function useMineFigures(opts: { enabled?: boolean } = {}) {
  const { getToken } = useAppAuth();
  return useQuery({
    queryKey: MINE_QUERY_KEY,
    queryFn: async () => {
      const data = await apiGet<{ figures: MineFigure[] }>("/api/figures/mine", await getToken());
      return data.figures;
    },
    enabled: opts.enabled ?? true,
  });
}

/**
 * Bookmark a figure by its figureRef (the Assemble placement-card / figure-editor
 * "add to my library" affordance, ⟳v5). A thin `useMutation` wrapper around
 * {@link saveFigureToLibrary} that invalidates the "mine" list on success, so a
 * caller reading `useMineFigures()` (or the derived bookmark set) sees the new
 * entry without a manual refetch.
 */
export function useBookmarkFigure() {
  const { getToken } = useAppAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (figureRef: string) => saveFigureToLibrary(await getToken(), { figureRef }),
    onSuccess: () => qc.invalidateQueries({ queryKey: MINE_QUERY_KEY }),
  });
}

/**
 * Un-bookmark a figure (⟳v5): removes the LibraryEntry only — the figure doc and
 * its placements are untouched (§5.2). Invalidates the "mine" list on success.
 */
export function useUnbookmarkFigure() {
  const { getToken } = useAppAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (figureRef: string) =>
      apiDelete<{ ok: true }>("/api/figures/save-to-library", await getToken(), { figureRef }),
    onSuccess: () => qc.invalidateQueries({ queryKey: MINE_QUERY_KEY }),
  });
}
