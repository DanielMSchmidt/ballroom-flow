// T6 — Journal tab component tests (frames 3.1–3.7). Empty state copy, a populated
// author-coloured list with kind pills + link chips, filter pills, the editor's
// Lesson/Practice toggle, and the link picker's disabled "An attribute" / media.
import { describe, expect, it, vi } from "vitest";
import type { JournalEntry } from "../store/journal";
import { renderUi, screen, userEvent, waitFor } from "../test-support/render";
import { Journal } from "./Journal";

const entry = (over: Partial<JournalEntry>): JournalEntry => ({
  id: "e1",
  routineRef: "rt",
  authorId: "coach",
  kind: "lesson",
  text: "heads stay left through the natural turn",
  anchors: [{ type: "point", figureRef: "f1", count: 1, label: "Natural Turn · step 2" }],
  createdAt: Date.now(),
  displayName: "Anna",
  identityColor: "#1f8a5b",
  source: "routine",
  ...over,
});

const noop = async (): Promise<void> => {};
const baseProps = {
  createFamilyEntry: vi.fn(noop),
  createRoutineEntry: vi.fn(noop),
  loadRoutineOptions: vi.fn(async () => []),
  loadRoutineFigures: vi.fn(async () => []),
};

describe("Journal list (frames 3.1 / 3.2)", () => {
  it("shows the empty state copy + New entry when there are no entries", async () => {
    renderUi(<Journal loadEntries={async () => []} {...baseProps} />);
    expect(await screen.findByText("No entries yet")).toBeInTheDocument();
    expect(screen.getByText(/Log a lesson or a practice session/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\+ New entry/i })).toBeInTheDocument();
  });

  it("renders author-coloured cards with kind pills + link chips", async () => {
    renderUi(
      <Journal
        loadEntries={async () => [
          entry({}),
          entry({
            id: "e2",
            kind: "practice",
            text: "ran the routine full 5x",
            anchors: [],
            displayName: "Lena",
          }),
        ]}
        currentUserId="me"
        {...baseProps}
      />,
    );
    expect(await screen.findByText("LESSON")).toBeInTheDocument();
    expect(screen.getByText("PRACTICE")).toBeInTheDocument();
    expect(screen.getByText("↳ Natural Turn · step 2")).toBeInTheDocument();
    expect(screen.getByText("Anna")).toBeInTheDocument();
  });

  it("toggles the lessons filter (aria-pressed) and hides practice entries", async () => {
    renderUi(
      <Journal
        loadEntries={async () => [
          entry({ id: "l", kind: "lesson", text: "lesson body" }),
          entry({ id: "p", kind: "practice", text: "practice body", anchors: [] }),
        ]}
        {...baseProps}
      />,
    );
    await screen.findByText("lesson body");
    const lessons = screen.getByRole("button", { name: /^lessons$/i });
    await userEvent.click(lessons);
    expect(lessons).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("practice body")).toBeNull();
    expect(screen.getByText("lesson body")).toBeInTheDocument();
  });
});

describe("Journal editor + link picker (frames 3.3 / 3.4)", () => {
  it("opens the editor with a Lesson/Practice toggle and a disabled media affordance", async () => {
    renderUi(<Journal loadEntries={async () => []} {...baseProps} />);
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    expect(screen.getByRole("region", { name: /journal entry editor/i })).toBeInTheDocument();
    // Lesson/Practice segmented toggle (frame 3.3).
    expect(screen.getByRole("radio", { name: "Lesson" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Practice" })).toBeInTheDocument();
    // Media is visibly disabled (coming soon), not hidden.
    expect(screen.getByRole("button", { name: /Add media \(coming soon\)/i })).toBeDisabled();
  });

  it("shows the link picker with a DISABLED attribute row (coming later · v1.1)", async () => {
    renderUi(<Journal loadEntries={async () => []} {...baseProps} />);
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    expect(screen.getByText("Link to…")).toBeInTheDocument();
    expect(screen.getByText("An attribute")).toBeInTheDocument();
    expect(screen.getByText(/coming later · v1\.1/i)).toBeInTheDocument();
    // Specific place is NOT disabled (full-parity LOCKED #1).
    const specific = screen.getByText("Specific place").closest("button");
    expect(specific).not.toBeDisabled();
  });

  it("builds a figureType link and saves it via createFamilyEntry", async () => {
    const createFamilyEntry = vi.fn(
      async (_input: {
        figureType: string;
        danceScope: string;
        kind: "note" | "lesson" | "practice";
        text: string;
      }) => {},
    );
    renderUi(
      <Journal loadEntries={async () => []} {...baseProps} createFamilyEntry={createFamilyEntry} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "whisk more cross");
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    // TYPE → A figure
    await userEvent.click(screen.getByText("A figure"));
    // FIGURE → pick the first family
    const families = await screen.findAllByLabelText("Figure families");
    const firstFamily = families[0]?.querySelector("button");
    if (firstFamily) await userEvent.click(firstFamily);
    // SCOPE → Every dance (figureType, danceScope all)
    await userEvent.click(await screen.findByText("Every dance"));
    // The chip appears in the editor; Done saves the family entry.
    await waitFor(() => expect(screen.getByText(/^↳ all /)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(createFamilyEntry).toHaveBeenCalledTimes(1));
    expect(createFamilyEntry.mock.calls[0]?.[0]).toMatchObject({
      kind: "lesson",
      danceScope: "all",
      text: "whisk more cross",
    });
  });

  it("links to a specific count via the search + grain steps (US-004a)", async () => {
    const createRoutineEntry = vi.fn(noop);
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createRoutineEntry={createRoutineEntry}
        loadRoutineOptions={vi.fn(async () => [
          { docRef: "rt1", title: "Gold Waltz", dance: "waltz" },
        ])}
        loadRoutineFigures={vi.fn(async () => [
          { figureRef: "f1", name: "Whisk", figureType: "whisk", counts: [1, 2, 3] },
          { figureRef: "f2", name: "Chassé", figureType: "chasse", counts: [1, 2] },
        ])}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "commit to the side step");
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    // TYPE → Specific place → pick the choreo.
    await userEvent.click(screen.getByText("Specific place"));
    await userEvent.click(await screen.findByText("Gold Waltz"));
    // Search filters the figure list down to "Whisk", then pick it.
    await userEvent.type(await screen.findByLabelText("Search figures"), "whis");
    expect(screen.queryByText("Chassé")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /whisk/i }));
    // GRAIN → "On count 2" builds a point anchor labelled "Whisk · count 2".
    await userEvent.click(await screen.findByText("On count 2"));
    await waitFor(() => expect(screen.getByText("↳ Whisk · count 2")).toBeInTheDocument());
  });

  it("links to a whole figure via the grain step (US-004a)", async () => {
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        loadRoutineOptions={vi.fn(async () => [
          { docRef: "rt1", title: "Gold Waltz", dance: "waltz" },
        ])}
        loadRoutineFigures={vi.fn(async () => [
          { figureRef: "f1", name: "Whisk", figureType: "whisk", counts: [1, 2, 3] },
        ])}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "note on the whole whisk");
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    await userEvent.click(screen.getByText("Specific place"));
    await userEvent.click(await screen.findByText("Gold Waltz"));
    await userEvent.click(await screen.findByRole("button", { name: /whisk/i }));
    await userEvent.click(await screen.findByText("The entire figure"));
    await waitFor(() => expect(screen.getByText("↳ Whisk · whole figure")).toBeInTheDocument());
  });
});
