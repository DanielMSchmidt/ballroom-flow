// US-032/033 — the figure-library screen wrapper: fetches the global library +
// the viewer's own figures via the store seam and feeds the presentational
// <FigureLibrary>. The dance filter is applied client-side inside FigureLibrary,
// so the global list is fetched once. (Components touch data only via store/.)
import { useGlobalFigures, useMyFigures } from "../store/figures";
import { Spinner } from "../ui";
import { FigureLibrary } from "./FigureLibrary";

export interface FigureLibraryScreenProps {
  /** Open a figure (navigate to its timeline). */
  onOpen?: (docRef: string) => void;
}

export function FigureLibraryScreen({ onOpen }: FigureLibraryScreenProps) {
  const global = useGlobalFigures();
  const mine = useMyFigures();

  if (global.isLoading || mine.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner label="Loading figures…" />
      </div>
    );
  }

  return (
    <FigureLibrary
      globalFigures={global.data?.figures ?? []}
      myFigures={mine.data?.figures ?? []}
      onOpen={onOpen}
    />
  );
}
