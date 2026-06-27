// US-040 / US-041 — figure-family notes surfaced on a figure. A note authored
// against a figure FAMILY ("every Feather") shows on this figure when the family
// matches and the dance scope covers this dance; co-members' notes appear too
// (the worker's co-membership gate). Commenter+ may author one here, choosing the
// dance scope via the AnchorPicker's "this figure family" option.
import type { Anchor, AnnotationKind, DanceId } from "@ballroom/domain";
import { useState } from "react";
import type { FamilyNote } from "../store/family-notes";
import { AnchorPicker } from "./AnchorPicker";

export interface FamilyNotesProps {
  /** The family of the figure in context (US-011 identity). */
  figureType: string;
  /** The dance of the figure — scopes which notes apply + the "this dance" value. */
  dance: DanceId;
  /** All family notes loaded for the routine (members' notes). */
  notes: FamilyNote[];
  /** Whether the viewer may author a family note (commenter+). */
  canAnnotate: boolean;
  /** Author a family note. */
  onCreate?: (input: {
    figureType: string;
    danceScope: string;
    kind: AnnotationKind;
    text: string;
  }) => void;
}

export function FamilyNotes({
  figureType,
  dance,
  notes,
  canAnnotate,
  onCreate,
}: FamilyNotesProps): React.JSX.Element {
  const [text, setText] = useState("");
  // The dance scope chosen via the AnchorPicker's "this figure family" option;
  // null until the user picks family (the compose button stays disabled).
  const [scope, setScope] = useState<string | null>(null);

  // Notes that apply to THIS figure: same family, and the scope covers this dance.
  const matching = notes.filter(
    (n) => n.figureType === figureType && (n.danceScope === "all" || n.danceScope === dance),
  );

  const onPick = (anchor: Anchor): void => {
    setScope(anchor.type === "figureType" ? anchor.danceScope : null);
  };

  const submit = (): void => {
    const body = text.trim();
    if (!body || !scope) return;
    onCreate?.({ figureType, danceScope: scope, kind: "lesson", text: body });
    setText("");
  };

  return (
    <section aria-label="Family notes">
      <h3 className="text-sm font-medium text-ink-secondary">Notes on every {figureType}</h3>
      <ul aria-label="family notes">
        {matching.map((n) => (
          <li key={n.id}>
            <span data-kind={n.kind}>{n.kind}</span> <span>{n.text}</span>{" "}
            <span className="text-2xs text-ink-faint">
              {n.danceScope === "all" ? "all dances" : n.danceScope}
            </span>
          </li>
        ))}
      </ul>

      {canAnnotate && (
        <form
          aria-label="Add family note"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <AnchorPicker figureType={figureType} dance={dance} onPick={onPick} />
          <textarea
            aria-label="family note"
            placeholder={`A note for every ${figureType}…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" disabled={!scope || !text.trim()}>
            Add family note
          </button>
        </form>
      )}
    </section>
  );
}
