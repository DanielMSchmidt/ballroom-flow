// T6 — Journal tab component tests (frames 3.1–3.7). Empty state copy, a populated
// author-coloured list with kind pills + link chips, filter pills, the editor's
// Lesson/Practice toggle, and the link picker's disabled "An attribute" / media.
import type { VoiceNoteProposal } from "@weavesteps/contract";
import { describe, expect, it, vi } from "vitest";
import type { SpeechCapture, SpeechCaptureCallbacks } from "../lib/speech";
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
// createRoutineEntry resolves to the created entry (WEP-0002 optimistic echo);
// null = "nothing to echo", the untested default.
const nullNoop = async (): Promise<null> => null;
const baseProps = {
  createFamilyEntry: vi.fn(noop),
  createRoutineEntry: vi.fn(nullNoop),
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

// docs/concepts/annotations.md § The Journal (WEP-0004) — the choreo-first link
// picker: choreo → figure (type-ahead) →
// placement grid (entire figure / one count, role lens) → scope LAST, gated by
// the placement (a timed note never spans dances).
const whiskFigures = [
  {
    figureRef: "f1",
    name: "Whisk",
    figureType: "whisk",
    counts: [1, 2, 3],
    hasFamily: true,
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
    hasFamily: true,
    attributes: [],
  },
];

// A from-scratch custom figure: its slugged figureType names no catalog family,
// so the scope step must not offer the family (figureType) options.
const customFigures = [
  {
    figureRef: "cf1",
    name: "My Signature Move",
    figureType: "my-signature-move",
    counts: [1, 2],
    hasFamily: false,
    attributes: [
      { id: "c1", kind: "footwork", count: 1, role: null, value: "flat", deletedAt: null },
    ],
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
    ) => null,
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
    // choreo → target step: take the figure path (attribute path covered separately).
    await userEvent.click(await screen.findByText("A figure from this choreo"));
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
    // choreo → target step: take the figure path (attribute path covered separately).
    await userEvent.click(await screen.findByText("A figure from this choreo"));
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
    // choreo → target step: take the figure path (attribute path covered separately).
    await userEvent.click(await screen.findByText("A figure from this choreo"));
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

  it("a CUSTOM figure offers no family scope — only this-choreo (the note falls through)", async () => {
    // A from-scratch custom figure has no catalog family, so there is nothing to
    // pin a family (figureType) note to. The scope step must drop both family
    // rows and offer only "This choreo only" — even for a whole-figure placement,
    // which for a library figure would show all three scopes.
    const createFamilyEntry = familyEntryMock();
    const createRoutineEntry = routineEntryMock();
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createFamilyEntry={createFamilyEntry}
        createRoutineEntry={createRoutineEntry}
        loadRoutineOptions={vi.fn(async () => goldWaltz)}
        loadRoutineFigures={vi.fn(async () => customFigures)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "keep the frame quiet here");
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    await userEvent.click(await screen.findByText("Gold Waltz"));
    // choreo → target step: take the figure path (attribute path covered separately).
    await userEvent.click(await screen.findByText("A figure from this choreo"));
    await userEvent.click(await screen.findByRole("button", { name: /^My Signature Move/ }));
    await userEvent.click(await screen.findByText("The entire figure"));
    // No family scopes — the choreo-wide (a real DanceId) and cross-dance rows are gone.
    expect(await screen.findByText("This choreo only")).toBeInTheDocument();
    expect(screen.queryByText("Every dance")).toBeNull();
    expect(screen.queryByText("All Waltz choreos")).toBeNull();
    // Falls through to a routine annotation (a whole-figure anchor), never a family note.
    await userEvent.click(screen.getByText("This choreo only"));
    await userEvent.click(await screen.findByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(createRoutineEntry).toHaveBeenCalledTimes(1));
    expect(createFamilyEntry).not.toHaveBeenCalled();
    expect(createRoutineEntry.mock.calls[0]?.[0]).toBe("rt1");
    expect(createRoutineEntry.mock.calls[0]?.[1]).toMatchObject({
      anchors: [{ type: "figure", figureRef: "cf1" }],
      text: "keep the frame quiet here",
    });
  });

  it("a CUSTOM figure with a picked count offers only this-choreo (no this-dance family row)", async () => {
    // A timed placement on a library figure offers "this dance" (a family note);
    // on a custom figure that family row must also drop, leaving only this-choreo,
    // which saves a point anchor via createRoutineEntry.
    const createFamilyEntry = familyEntryMock();
    const createRoutineEntry = routineEntryMock();
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createFamilyEntry={createFamilyEntry}
        createRoutineEntry={createRoutineEntry}
        loadRoutineOptions={vi.fn(async () => goldWaltz)}
        loadRoutineFigures={vi.fn(async () => customFigures)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "settle on the second beat");
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    await userEvent.click(await screen.findByText("Gold Waltz"));
    // choreo → target step: take the figure path (attribute path covered separately).
    await userEvent.click(await screen.findByText("A figure from this choreo"));
    await userEvent.click(await screen.findByRole("button", { name: /^My Signature Move/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^count 2/i }));
    expect(await screen.findByText("This choreo only")).toBeInTheDocument();
    expect(screen.queryByText("All Waltz choreos")).toBeNull();
    expect(screen.queryByText("Every dance")).toBeNull();
    await userEvent.click(screen.getByText("This choreo only"));
    await userEvent.click(await screen.findByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(createRoutineEntry).toHaveBeenCalledTimes(1));
    expect(createFamilyEntry).not.toHaveBeenCalled();
    expect(createRoutineEntry.mock.calls[0]?.[1]).toMatchObject({
      anchors: [{ type: "point", figureRef: "cf1", count: 2 }],
    });
  });

  it("saves without a link when text is present (no link required)", async () => {
    const createFamilyEntry = familyEntryMock();
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createFamilyEntry={createFamilyEntry}
        loadRoutineOptions={vi.fn(async () => [])}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    const done = screen.getByRole("button", { name: /^done$/i });
    // done is disabled with no text…
    expect(done).toBeDisabled();
    await userEvent.type(screen.getByLabelText("entry text"), "worked on posture today");
    // …enabled with text, even without a link.
    expect(done).not.toBeDisabled();
    await userEvent.click(done);
    await waitFor(() => expect(createFamilyEntry).toHaveBeenCalledTimes(1));
    expect(createFamilyEntry.mock.calls[0]?.[0]).toMatchObject({
      figureType: "general",
      danceScope: "all",
      kind: "lesson",
      text: "worked on posture today",
    });
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
    // choreo → target step: take the figure path (attribute path covered separately).
    await userEvent.click(await screen.findByText("A figure from this choreo"));
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

  // #293 — an entry carrying BOTH a routine link and an account figureType link
  // must write BOTH: the routine annotation AND one family note per figureType
  // link. Previously the routine link short-circuited and the account links were
  // dropped silently.
  //
  // Adds `link` to the currently-open picker: pick a figure, then a placement +
  // scope. `scope === "This choreo only"` → a routine point link;
  // `scope === "Every dance"` / `"All Waltz choreos"` → an account figureType link.
  async function addWholeFigureLink(
    figureName: RegExp,
    scope: "This choreo only" | "Every dance" | "All Waltz choreos",
  ): Promise<void> {
    await userEvent.click(screen.getByText(/link to a step, figure or attribute/i));
    await userEvent.click(await screen.findByText("Gold Waltz"));
    // The picker's target step (choreo → target → figure|attribute) landed with
    // the attribute-predicate anchors; a whole-figure link goes via "A figure".
    await userEvent.click(await screen.findByText("A figure from this choreo"));
    await userEvent.click(await screen.findByRole("button", { name: figureName }));
    await userEvent.click(await screen.findByText("The entire figure"));
    await userEvent.click(await screen.findByText(scope));
  }

  it("#293: a routine link + one account figureType link writes BOTH", async () => {
    const createFamilyEntry = familyEntryMock();
    const createRoutineEntry = routineEntryMock();
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createFamilyEntry={createFamilyEntry}
        createRoutineEntry={createRoutineEntry}
        loadRoutineOptions={vi.fn(async () => goldWaltz)}
        loadRoutineFigures={vi.fn(async () => whiskFigures)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "sway then commit");
    // A routine-scoped link (this-choreo only, a whole-figure anchor)…
    await addWholeFigureLink(/^Whisk/, "This choreo only");
    // …AND an account figureType link (all Whisks, every dance).
    await addWholeFigureLink(/^Whisk/, "Every dance");
    await waitFor(() =>
      expect(screen.getByText(/^↳ all Whisks · all dances$/)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));

    await waitFor(() => expect(createRoutineEntry).toHaveBeenCalledTimes(1));
    expect(createRoutineEntry.mock.calls[0]?.[0]).toBe("rt1");
    expect(createRoutineEntry.mock.calls[0]?.[1]).toMatchObject({
      anchors: [{ type: "figure", figureRef: "f1" }],
      text: "sway then commit",
    });
    // The bug: this family note was silently dropped when a routine link was present.
    await waitFor(() => expect(createFamilyEntry).toHaveBeenCalledTimes(1));
    expect(createFamilyEntry.mock.calls[0]?.[0]).toMatchObject({
      figureType: "whisk",
      danceScope: "all",
      kind: "lesson",
      text: "sway then commit",
    });
  });

  it("#293: a routine link + two account figureType links writes all three", async () => {
    const createFamilyEntry = familyEntryMock();
    const createRoutineEntry = routineEntryMock();
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createFamilyEntry={createFamilyEntry}
        createRoutineEntry={createRoutineEntry}
        loadRoutineOptions={vi.fn(async () => goldWaltz)}
        loadRoutineFigures={vi.fn(async () => whiskFigures)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "shape across the pair");
    // A routine link plus TWO account figureType links on the same family at
    // different scopes (cross-dance + this-dance) — all three must land.
    await addWholeFigureLink(/^Whisk/, "This choreo only");
    await addWholeFigureLink(/^Whisk/, "Every dance");
    await addWholeFigureLink(/^Whisk/, "All Waltz choreos");
    await waitFor(() => expect(screen.getByText(/^↳ all Whisks · all Waltz$/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));

    await waitFor(() => expect(createRoutineEntry).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createFamilyEntry).toHaveBeenCalledTimes(2));
    const scopes = createFamilyEntry.mock.calls.map((c) => c[0]?.danceScope);
    expect(scopes).toEqual(["all", "waltz"]);
    for (const call of createFamilyEntry.mock.calls) {
      expect(call[0]).toMatchObject({ figureType: "whisk", text: "shape across the pair" });
    }
  });

  // Regressions — each link kind ALONE must still behave exactly as before the
  // #293 fix (proves the independent-write change didn't disturb the single-kind
  // paths).
  it("#293 regression: a routine link alone writes only the routine annotation", async () => {
    const createFamilyEntry = familyEntryMock();
    const createRoutineEntry = routineEntryMock();
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createFamilyEntry={createFamilyEntry}
        createRoutineEntry={createRoutineEntry}
        loadRoutineOptions={vi.fn(async () => goldWaltz)}
        loadRoutineFigures={vi.fn(async () => whiskFigures)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "routine only");
    await addWholeFigureLink(/^Whisk/, "This choreo only");
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(createRoutineEntry).toHaveBeenCalledTimes(1));
    expect(createFamilyEntry).not.toHaveBeenCalled();
  });

  it("#293 regression: an account figureType link alone writes only the family note", async () => {
    const createFamilyEntry = familyEntryMock();
    const createRoutineEntry = routineEntryMock();
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createFamilyEntry={createFamilyEntry}
        createRoutineEntry={createRoutineEntry}
        loadRoutineOptions={vi.fn(async () => goldWaltz)}
        loadRoutineFigures={vi.fn(async () => whiskFigures)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.type(screen.getByLabelText("entry text"), "family only");
    await addWholeFigureLink(/^Whisk/, "Every dance");
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(createFamilyEntry).toHaveBeenCalledTimes(1));
    expect(createRoutineEntry).not.toHaveBeenCalled();
    expect(createFamilyEntry.mock.calls[0]?.[0]).toMatchObject({
      figureType: "whisk",
      danceScope: "all",
    });
  });
});

describe("Journal editor — AI voice path (the AI never writes; Confirm uses the ordinary seams)", () => {
  // A scripted capture the test drives to emit a final transcript on demand.
  function scriptedCapture(): { capture: SpeechCapture; emit: (text: string) => void } {
    let cb: SpeechCaptureCallbacks | null = null;
    return {
      capture: {
        onDevice: true,
        start(c) {
          cb = c;
        },
        stop() {},
      },
      emit: (text) => cb?.onTranscript(text, true),
    };
  }

  const familyProposal: VoiceNoteProposal = {
    resolved: true,
    noteText: "settle the sway",
    confidence: "high",
    proposed: {
      anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
      routineRef: null,
      label: "all Feathers · all Foxtrot",
    },
    alternatives: [],
  };

  const figureProposal: VoiceNoteProposal = {
    resolved: true,
    noteText: "more diagonal",
    confidence: "medium",
    proposed: {
      anchor: { type: "figure", figureRef: "fig_bounce_1" },
      routineRef: "rt_comp",
      label: "Bounce Fallaway · Comp Slowfox",
    },
    alternatives: [],
  };

  async function openEditorWithVoice(
    proposal: VoiceNoteProposal,
    seams: {
      createFamilyEntry: ReturnType<typeof familyEntryMock>;
      createRoutineEntry: ReturnType<typeof routineEntryMock>;
    },
  ) {
    const { capture, emit } = scriptedCapture();
    const interpretVoice = vi.fn(async () => proposal);
    renderUi(
      <Journal
        loadEntries={async () => []}
        {...baseProps}
        createFamilyEntry={seams.createFamilyEntry}
        createRoutineEntry={seams.createRoutineEntry}
        createSpeechCapture={() => capture}
        interpretVoice={interpretVoice}
        transcribeVoice={async () => ""}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /\+ New entry/i }));
    await userEvent.click(screen.getByRole("button", { name: /^voice$/i }));
    return { emit, interpretVoice };
  }

  it("a figureType proposal confirms through createFamilyEntry (same payload as the picker)", async () => {
    const createFamilyEntry = familyEntryMock();
    const createRoutineEntry = routineEntryMock();
    const { emit } = await openEditorWithVoice(familyProposal, {
      createFamilyEntry,
      createRoutineEntry,
    });
    emit("In Slowfox, in Feather Steps, settle the sway.");
    await waitFor(() => expect(screen.getByText("Confirm & save")).toBeInTheDocument());
    // No save seam fires before Confirm.
    expect(createFamilyEntry).not.toHaveBeenCalled();
    expect(createRoutineEntry).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Confirm & save"));
    // The proposal became an ordinary link + text; Done drives the unchanged save.
    await waitFor(() =>
      expect(screen.getByText("↳ all Feathers · all Foxtrot")).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(createFamilyEntry).toHaveBeenCalledTimes(1));
    expect(createFamilyEntry.mock.calls[0]?.[0]).toMatchObject({
      figureType: "feather",
      danceScope: "foxtrot",
      kind: "lesson",
      text: "settle the sway",
    });
    expect(createRoutineEntry).not.toHaveBeenCalled();
  });

  it("a figure proposal confirms through createRoutineEntry with the figure anchor", async () => {
    const createFamilyEntry = familyEntryMock();
    const createRoutineEntry = routineEntryMock();
    const { emit } = await openEditorWithVoice(figureProposal, {
      createFamilyEntry,
      createRoutineEntry,
    });
    emit("In my competition slowfox, on the first bounce fallaway, more diagonal.");
    await waitFor(() => expect(screen.getByText("Confirm & save")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Confirm & save"));
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(createRoutineEntry).toHaveBeenCalledTimes(1));
    expect(createRoutineEntry.mock.calls[0]?.[0]).toBe("rt_comp");
    expect(createRoutineEntry.mock.calls[0]?.[1]).toMatchObject({
      anchors: [{ type: "figure", figureRef: "fig_bounce_1" }],
      text: "more diagonal",
    });
    expect(createFamilyEntry).not.toHaveBeenCalled();
  });

  it("an unresolved proposal keeps the transcript as text with no link", async () => {
    const createFamilyEntry = familyEntryMock();
    const createRoutineEntry = routineEntryMock();
    const unresolved: VoiceNoteProposal = {
      resolved: false,
      noteText: "Remember to breathe.",
      confidence: "low",
      proposed: null,
      alternatives: [],
    };
    const { emit } = await openEditorWithVoice(unresolved, {
      createFamilyEntry,
      createRoutineEntry,
    });
    emit("Remember to breathe and stay grounded.");
    await waitFor(() => expect(screen.getByText("Keep as note text")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Keep as note text"));
    // The transcript fills the textarea; no link chip.
    await waitFor(() =>
      expect(screen.getByLabelText("entry text")).toHaveValue(
        "Remember to breathe and stay grounded.",
      ),
    );
    expect(screen.queryByText(/↳/)).toBeNull();
  });
});
