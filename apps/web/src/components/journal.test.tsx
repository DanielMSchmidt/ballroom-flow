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

// WEP-0004 — the choreo-first link picker: choreo → figure (type-ahead) →
// placement grid (entire figure / one count, role lens) → scope LAST, gated by
// the placement (a timed note never spans dances).
const whiskFigures = [
  {
    figureRef: "f1",
    name: "Whisk",
    figureType: "whisk",
    counts: [1, 2, 3],
    attributes: [
      { id: "a1", kind: "footwork", count: 1, role: null, value: "HT", deletedAt: null },
      { id: "a2", kind: "rise", count: 2, role: null, value: "body rise", deletedAt: null },
      {
        id: "a3",
        kind: "footwork",
        count: 3,
        role: "leader" as const,
        value: "TH",
        deletedAt: null,
      },
    ],
  },
  {
    figureRef: "f2",
    name: "Chassé",
    figureType: "chasse",
    counts: [1, 2],
    attributes: [],
  },
];
const goldWaltz = [{ docRef: "rt1", title: "Gold Waltz", dance: "waltz" }];

/** Typed create-mocks so `mock.calls[0]?.[0]` keeps a real tuple type. */
const familyEntryMock = () =>
  vi.fn(
    async (_input: {
      figureType: string;
      danceScope: string;
      kind: "note" | "lesson" | "practice";
      text: string;
      count?: number;
      role?: "leader" | "follower";
    }) => {},
  );
const routineEntryMock = () =>
  vi.fn(
    async (
      _routineRef: string,
      _input: { kind: "note" | "lesson" | "practice"; text: string; anchors: unknown[] },
    ) => {},
  );

describe("Journal editor + link picker (WEP-0004 choreo-first flow)", () => {
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

  it("opens the picker ON the choreo list (choreo-first, no link-type fork)", async () => {
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        loadRoutineOptions={vi.fn(async () => goldWaltz)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    expect(screen.getByText("Which choreo?")).toBeInTheDocument();
    expect(await screen.findByText("Gold Waltz")).toBeInTheDocument();
    // The old type fork is gone — no catalog path, no attribute teaser.
    expect(screen.queryByText("Link to…")).toBeNull();
    expect(screen.queryByText("A figure")).toBeNull();
    expect(screen.queryByText("An attribute")).toBeNull();
  });

  it("type-ahead filters the choreo's figures; the grid shows the figure's chips", async () => {
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        loadRoutineOptions={vi.fn(async () => goldWaltz)}
        loadRoutineFigures={vi.fn(async () => whiskFigures)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    await userEvent.click(await screen.findByText("Gold Waltz"));
    // Type-ahead: "whis" narrows the list down to the Whisk.
    await userEvent.type(await screen.findByLabelText("Search figures"), "whis");
    expect(screen.queryByText("Chassé")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /whisk/i }));
    // The placement grid renders the figure's real attribute values (detail-view
    // style) so the right count is easy to find.
    expect(await screen.findByText("Where on Whisk?")).toBeInTheDocument();
    expect(screen.getByText("HT")).toBeInTheDocument();
    expect(screen.getByText("body rise")).toBeInTheDocument();
  });

  it("a TIMED placement offers this-dance/this-choreo only, and saves count+role (WEP-0004)", async () => {
    const createFamilyEntry = familyEntryMock();
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createFamilyEntry={createFamilyEntry}
        loadRoutineOptions={vi.fn(async () => goldWaltz)}
        loadRoutineFigures={vi.fn(async () => whiskFigures)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "settle before the chassé");
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    await userEvent.click(await screen.findByText("Gold Waltz"));
    await userEvent.click(await screen.findByRole("button", { name: /^Whisk/ }));
    // Narrow to the leader's side, then pick count 3 from the grid.
    await userEvent.click(await screen.findByRole("radio", { name: "Leader" }));
    await userEvent.click(screen.getByRole("button", { name: /^count 3/i }));
    // Scope LAST — a timed note never spans dances: no "Every dance" row.
    expect(await screen.findByText("All Waltz choreos")).toBeInTheDocument();
    expect(screen.queryByText("Every dance")).toBeNull();
    await userEvent.click(screen.getByText("All Waltz choreos"));
    // Chip carries family + dance + count + side; Done saves a timed family entry.
    await waitFor(() =>
      expect(screen.getByText(/↳ all Whisks · all Waltz · count 3 · Leader/)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(createFamilyEntry).toHaveBeenCalledTimes(1));
    expect(createFamilyEntry.mock.calls[0]?.[0]).toMatchObject({
      figureType: "whisk",
      danceScope: "waltz",
      count: 3,
      role: "leader",
      kind: "lesson",
      text: "settle before the chassé",
    });
  });

  it("a whole-figure placement offers all three scopes; Every dance saves danceScope 'all'", async () => {
    const createFamilyEntry = familyEntryMock();
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createFamilyEntry={createFamilyEntry}
        loadRoutineOptions={vi.fn(async () => goldWaltz)}
        loadRoutineFigures={vi.fn(async () => whiskFigures)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "whisk more cross");
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    await userEvent.click(await screen.findByText("Gold Waltz"));
    await userEvent.click(await screen.findByRole("button", { name: /^Whisk/ }));
    await userEvent.click(await screen.findByText("The entire figure"));
    // Whole-figure → the cross-dance scope IS offered.
    expect(await screen.findByText("Every dance")).toBeInTheDocument();
    expect(screen.getByText("All Waltz choreos")).toBeInTheDocument();
    expect(screen.getByText("This choreo only")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Every dance"));
    await waitFor(() =>
      expect(screen.getByText(/^↳ all Whisks · all dances$/)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(createFamilyEntry).toHaveBeenCalledTimes(1));
    expect(createFamilyEntry.mock.calls[0]?.[0]).toMatchObject({
      figureType: "whisk",
      danceScope: "all",
      text: "whisk more cross",
    });
    expect(createFamilyEntry.mock.calls[0]?.[0]).not.toHaveProperty("count");
  });

  it("this-choreo-only with a count builds a point anchor and saves via createRoutineEntry", async () => {
    const createRoutineEntry = routineEntryMock();
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createRoutineEntry={createRoutineEntry}
        loadRoutineOptions={vi.fn(async () => goldWaltz)}
        loadRoutineFigures={vi.fn(async () => whiskFigures)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "commit to the side step");
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    await userEvent.click(await screen.findByText("Gold Waltz"));
    await userEvent.click(await screen.findByRole("button", { name: /^Whisk/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^count 2/i }));
    await userEvent.click(await screen.findByText("This choreo only"));
    await waitFor(() => expect(screen.getByText("↳ Whisk · count 2")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(createRoutineEntry).toHaveBeenCalledTimes(1));
    expect(createRoutineEntry.mock.calls[0]?.[0]).toBe("rt1");
    expect(createRoutineEntry.mock.calls[0]?.[1]).toMatchObject({
      anchors: [{ type: "point", figureRef: "f1", count: 2 }],
      text: "commit to the side step",
    });
  });
});
