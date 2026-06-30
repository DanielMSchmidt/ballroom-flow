// US-040 / US-041 — FamilyNotes surfacing + authoring.
import { describe, expect, it, vi } from "vitest";
import type { FamilyNote } from "../store/family-notes";
import { renderUi, screen, userEvent } from "../test-support/render";
import { FamilyNotes } from "./FamilyNotes";

const note = (over: Partial<FamilyNote>): FamilyNote => ({
  id: "n1",
  authorId: "coach",
  kind: "lesson",
  text: "head left",
  figureType: "feather",
  danceScope: "all",
  anchors: [],
  ...over,
});

describe("FamilyNotes", () => {
  it("surfaces only matching family notes, read-only for a viewer", () => {
    renderUi(
      <FamilyNotes
        figureType="feather"
        dance="foxtrot"
        canAnnotate={false}
        notes={[note({}), note({ id: "n2", text: "nope", figureType: "spin_turn" })]}
      />,
    );
    expect(screen.getByText("head left")).toBeInTheDocument();
    expect(screen.queryByText("nope")).toBeNull(); // different family
    expect(screen.queryByRole("button", { name: /add family note/i })).toBeNull();
  });

  it("authors an all-dances family note via the anchor picker", async () => {
    const onCreate = vi.fn();
    renderUi(
      <FamilyNotes
        figureType="feather"
        dance="foxtrot"
        canAnnotate
        notes={[]}
        onCreate={onCreate}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /this figure family/i }));
    await userEvent.click(screen.getByRole("radio", { name: /all dances/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /family note/i }), "keep head left");
    await userEvent.click(screen.getByRole("button", { name: /add family note/i }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ figureType: "feather", danceScope: "all", text: "keep head left" }),
    );
  });
});
