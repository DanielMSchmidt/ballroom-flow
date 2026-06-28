// Figure reference resolution — the fix for spurious "unknown figure" display.
//
// A figure card draws on two sources (design-spec §2.1, §2.3):
//   1. the persisted figure ROW from the routine tree (D1, loaded async via RPC);
//   2. the static LibraryFigure CATALOG (ships in the client bundle), matched by
//      `libraryFigureId` for enrichment (default charts, glossary).
//
// Two design rules keep "Unknown figure" from appearing when it shouldn't:
//   • Part A — identity comes from the ROW, never the catalog. The row carries
//     `name`, so a missed catalog lookup degrades gracefully (we still show the
//     name) instead of dead-ending on "unknown".
//   • Part B — resolution is a three-state result. "Not loaded yet" (loading) is
//     distinct from "loaded but genuinely dangling" (unresolved); only the latter
//     is a real problem, and even it keeps the row's name.

import type { RemoteData } from "./remote-data";

/**
 * A catalog entry (static reference data in the client bundle). This is the
 * minimal shape resolution needs; the full catalogue with default leader/follower
 * charts arrives with the figure library. Keyed by `id`, matched against a row's
 * `libraryFigureId`.
 */
export interface LibraryFigure {
  id: string;
  name: string;
}

/**
 * The persisted figure row from the routine tree. Source of truth for a figure's
 * identity — crucially `name` lives here (design-spec §2.1), so resolution never
 * needs the catalog just to know what a figure is called.
 */
export interface FigureRow {
  id: string;
  name: string;
  source: "library" | "custom";
  libraryFigureId: string | null;
}

/** Normalized routine-tree slice the resolver reads: figures keyed by id. */
export interface RoutineTree {
  figures: Record<string, FigureRow>;
}

/**
 * The three states of a derived figure reference. `loading` and `unresolved` are
 * deliberately separate — a reference we can't resolve *yet* is not the same as
 * one that is genuinely dangling, and only the latter should ever read as
 * "unrecognized" in the UI. Both `resolved` and `unresolved` carry `name`, so the
 * UI always has something real to show.
 */
export type FigureView<C extends LibraryFigure = LibraryFigure> =
  | { status: "loading" }
  | { status: "resolved"; name: string; figure: FigureRow; library: C | null }
  | { status: "unresolved"; name: string; figure: FigureRow; libraryFigureId: string };

/**
 * Resolve a single figure row against the bundled catalog.
 *
 * `figure === undefined` means the row isn't available yet (tree still loading,
 * or not present in this slice) — that is `loading`, NOT unknown. Custom figures
 * resolve with no catalog entry by design. A library figure whose id is absent
 * from the catalog is `unresolved` (e.g. bundle/version skew) but still surfaces
 * its stored name.
 */
export function resolveFigure<C extends LibraryFigure>(
  figure: FigureRow | undefined,
  catalog: ReadonlyMap<string, C>,
): FigureView<C> {
  if (figure === undefined) return { status: "loading" };

  // Custom figures are self-contained — no catalog entry is expected.
  if (figure.source === "custom" || figure.libraryFigureId === null) {
    return { status: "resolved", name: figure.name, figure, library: null };
  }

  const library = catalog.get(figure.libraryFigureId);
  if (library === undefined) {
    return {
      status: "unresolved",
      name: figure.name,
      figure,
      libraryFigureId: figure.libraryFigureId,
    };
  }

  return { status: "resolved", name: figure.name, figure, library };
}

/**
 * Resolve a figure straight from the routine-tree load state. While the tree is
 * anything but `success` the card shows `loading` (the routine-level UI owns the
 * error banner); once loaded, resolution is delegated to {@link resolveFigure}.
 */
export function selectFigureView<C extends LibraryFigure>(
  tree: RemoteData<RoutineTree>,
  figureId: string,
  catalog: ReadonlyMap<string, C>,
): FigureView<C> {
  if (tree.status !== "success") return { status: "loading" };
  return resolveFigure(tree.value.figures[figureId], catalog);
}
