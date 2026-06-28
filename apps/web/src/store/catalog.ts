import type { LibraryFigure } from "@ballroom/domain";

/**
 * The bundled figure catalog (static reference data, design-spec §2.3) — keyed by
 * `libraryFigureId`. The full catalogue with default leader/follower charts ships
 * with the figure library; until it lands this is empty, and library figures
 * degrade to their stored name via `resolveFigure` rather than dead-ending.
 */
export const FIGURE_CATALOG: ReadonlyMap<string, LibraryFigure> = new Map();
