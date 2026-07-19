// store/ seam (US-033): the user's LIBRARY — bookmarked figures (⟳v5,
// docs/concepts/figures.md § The library screen / § Variants). Components
// touch ONLY the store (this) + ui — never lib/rpc
// directly (§3/AC-4). Built on the same react-query + lib/rpc pattern as
// store/routines.ts.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SaveToLibrary } from "@weavesteps/contract";
import { type FigureDoc, LIBRARY_FIGURES, parseGlobalFigureRef } from "@weavesteps/domain";
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
 * my library", T5 ⟳v5) — a REFERENCE, never a copy (docs/concepts/figures.md
 * § The library screen / § Variants). Accepts
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

/**
 * Read-your-writes merge for the Add-figure picker (docs/system/architecture.md
 * § D1 — the index & projections, "reads split by audience"): a bookmark lands
 * in the LIVE account doc instantly, but `/api/figures/mine` reads the
 * alarm-written `library_entry` projection — so a one-shot fetch that preceded
 * the bookmark reliably misses the figure the user just saved. Self-reads come
 * from live docs: merge the live-bookmarked figures resolvable from the open
 * routine's placed figure docs (the only surface an in-choreo bookmark can come
 * from) over the REST list. Dedupe by docRef with the REST row winning (it
 * carries the cross-routine `usedInCount`) — the same rule as the Journal's
 * `mergeLiveFamilyNotes`/`mergePendingEntries` (PR #255). Catalog (`global:`)
 * refs are skipped: their preset row already lists them. Bookmarks placed only
 * in OTHER routines have no live doc here to resolve metadata from; they stay
 * eventually consistent via the projection.
 */
export function mergeLiveBookmarkedFigures(
  mine: MineFigure[],
  bookmarkedRefs: ReadonlySet<string>,
  placed: ReadonlyArray<{ figure: FigureDoc | null }>,
): MineFigure[] {
  const seen = new Set(mine.map((f) => f.docRef));
  const merged = [...mine];
  for (const { figure } of placed) {
    if (!figure || seen.has(figure.id) || !bookmarkedRefs.has(figure.id)) continue;
    if (parseGlobalFigureRef(figure.id) != null) continue;
    seen.add(figure.id);
    merged.push({
      docRef: figure.id,
      title: figure.name,
      figureType: figure.figureType,
      dance: figure.dance,
      baseFigureRef: figure.baseFigureRef ?? null,
      // The echo can only see the open routine — the figure is referenced at
      // least here; the projection's cross-routine count takes over on catch-up.
      usedInCount: 1,
    });
  }
  return merged;
}

/**
 * The Library screen's twin of {@link mergeLiveBookmarkedFigures}: the "My
 * figures" tab reads `/api/figures/mine` (the alarm-written `library_entry`
 * projection), so a catalog figure the user just "↟ save"d through the live
 * account doc is reliably missing from a fetch that raced the alarm. A catalog
 * `global:<dance>:<figureType>` ref carries its own identity — resolve its
 * metadata from the bundled catalog (mirroring the worker's `listMineFigures`
 * catalog branch) and synthesize the row. Dedupe by docRef with the REST row
 * winning (it carries the real cross-routine `usedInCount`). Account-figure
 * refs are skipped: this surface has no live figure doc to resolve them from,
 * so they stay eventually consistent via the projection.
 */
export function mergeLiveCatalogBookmarks(
  mine: MineFigure[],
  liveRefs: readonly string[],
): MineFigure[] {
  const seen = new Set(mine.map((f) => f.docRef));
  const merged = [...mine];
  for (const ref of liveRefs) {
    if (seen.has(ref)) continue;
    const parsed = parseGlobalFigureRef(ref);
    if (!parsed) continue;
    seen.add(ref);
    const catalog = LIBRARY_FIGURES.find(
      (f) => f.dance === parsed.dance && f.figureType === parsed.figureType,
    );
    merged.push({
      docRef: ref,
      title: catalog?.name ?? parsed.figureType,
      figureType: parsed.figureType,
      dance: parsed.dance,
      baseFigureRef: null, // the catalog original, not a variant of anything
      usedInCount: 0, // the projection's cross-routine count takes over on catch-up
    });
  }
  return merged;
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
