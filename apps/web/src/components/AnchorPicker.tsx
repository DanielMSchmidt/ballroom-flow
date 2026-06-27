// US-040 — the anchor picker: choose what an annotation attaches to. A point
// ("this step"), the figure here ("this figure here"), or the whole figure
// FAMILY ("this figure family") with a this-dance | all-dances scope toggle.
// PLAN §4.6, §5.1, D29.
//
// Presentational: it reports the chosen anchor via `onPick`; the screen (Task 8)
// routes a point/figure anchor to the routine store and a family anchor to the
// account doc.
import type { Anchor, DanceId } from "@ballroom/domain";
import { useState } from "react";

export interface AnchorPickerProps {
  /** The figure family this picker anchors against (US-011 identity). */
  figureType: string;
  /** The dance of the figure in context — the "this dance" scope value. */
  dance: DanceId;
  /** The reference to anchor a point/figure note against (the placement's figure). */
  figureRef?: string;
  /** Report the chosen anchor. */
  onPick?: (anchor: Anchor) => void;
}

type Choice = "step" | "figure" | "family";
type Scope = "this" | "all";

export function AnchorPicker({
  figureType,
  dance,
  figureRef = "",
  onPick,
}: AnchorPickerProps): React.JSX.Element {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [scope, setScope] = useState<Scope>("this");

  const pickFamily = (next: Scope): void => {
    setChoice("family");
    setScope(next);
    onPick?.({
      type: "figureType",
      figureType,
      danceScope: next === "all" ? "all" : dance,
    });
  };

  return (
    <fieldset aria-label="Anchor this note to">
      <button
        type="button"
        aria-pressed={choice === "step"}
        onClick={() => {
          setChoice("step");
          onPick?.({ type: "point", figureRef, count: 0, role: null });
        }}
      >
        this step
      </button>
      <button
        type="button"
        aria-pressed={choice === "figure"}
        onClick={() => {
          setChoice("figure");
          onPick?.({ type: "figure", figureRef });
        }}
      >
        this figure here
      </button>
      <button type="button" aria-pressed={choice === "family"} onClick={() => pickFamily(scope)}>
        this figure family
      </button>

      {choice === "family" && (
        <fieldset>
          <legend>Across</legend>
          <label>
            <input
              type="radio"
              name="dance-scope"
              checked={scope === "this"}
              onChange={() => pickFamily("this")}
            />{" "}
            this dance
          </label>
          <label>
            <input
              type="radio"
              name="dance-scope"
              checked={scope === "all"}
              onChange={() => pickFamily("all")}
            />{" "}
            all dances
          </label>
        </fieldset>
      )}
    </fieldset>
  );
}
