// US-040 — the anchor picker: choose what an annotation attaches to. A point
// ("this step"), the figure here ("this figure here"), or the whole figure
// FAMILY ("this figure family") with a this-dance | all-dances scope toggle.
// docs/concepts/annotations.md § The Journal; docs/concepts/collaboration.md § Roles;
// docs/concepts/annotations.md § Ownership & visibility (D29).
//
// Presentational: it reports the chosen anchor via `onPick`; the screen (Task 8)
// routes a point/figure anchor to the routine store and a family anchor to the
// account doc.
//
// Styling: the three anchor choices are `Chip` toggles (the app's "pick one"
// pattern — 44px target, focus ring, aria-pressed); the dance scope stays a
// native radio group (the family identity the tests assert on).
import type { Anchor, DanceId } from "@weavesteps/domain";
import { useState } from "react";
import { useMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";
import { Chip } from "../ui";

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
  const t = useMessages(journalMessages);
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
    <fieldset aria-label={t.anchorLegend} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Chip
          selected={choice === "step"}
          onClick={() => {
            setChoice("step");
            onPick?.({ type: "point", figureRef, count: 0, role: null });
          }}
        >
          {t.anchorStep}
        </Chip>
        <Chip
          selected={choice === "figure"}
          onClick={() => {
            setChoice("figure");
            onPick?.({ type: "figure", figureRef });
          }}
        >
          {t.anchorFigure}
        </Chip>
        <Chip selected={choice === "family"} onClick={() => pickFamily(scope)}>
          {t.anchorFamily}
        </Chip>
      </div>

      {choice === "family" && (
        <fieldset className="flex flex-wrap items-center gap-3 rounded-md border border-line p-2">
          <legend className="text-2xs font-bold uppercase tracking-wide text-ink-muted">
            {t.across}
          </legend>
          <label className="flex items-center gap-1.5 text-sm text-ink-secondary">
            <input
              type="radio"
              name="dance-scope"
              checked={scope === "this"}
              onChange={() => pickFamily("this")}
            />
            {t.thisDance}
          </label>
          <label className="flex items-center gap-1.5 text-sm text-ink-secondary">
            <input
              type="radio"
              name="dance-scope"
              checked={scope === "all"}
              onChange={() => pickFamily("all")}
            />
            {t.allDances}
          </label>
        </fieldset>
      )}
    </fieldset>
  );
}
