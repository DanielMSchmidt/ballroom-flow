// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { Attribute, FigureDoc, Placement, RoutineDoc } from "@weavesteps/domain";
import { libraryFiguresForDance } from "@weavesteps/domain";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedPlacement, RoutineStore } from "../store/routine";
import { importComponent } from "../test-support/import-component";
import { axeCheck, renderUi, screen, userEvent, within } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// US-018 — Open & view a routine [M2, user]
// US-026 — Add / rename / reorder / delete sections [M3, user]
// US-027 — Add / reorder / delete figure placements [M3, user]
// US-031 — Edit per-figure alignment [M4, user]
//
// PLAN §4.3, §10.2 component layer: "section rename; placement cards; viewer/
// commenter gating; alignment chips". Assemble screen built by the frontend
// agent → dynamic import behind it.skip.
// ─────────────────────────────────────────────────────────────────────────

interface AssembleModule {
  Assemble: ComponentType<Record<string, unknown>>;
}

// The store seam is the component's ONLY data source (CLAUDE.md §3). We inject a
// pre-seeded fake store — mirroring how the store itself injects its socket — so
// the screen renders synced data without a live worker (jsdom has no WS server).
// The live multi-doc sync is the store seam's own test + the #116 wrangler smoke.
function fakeStore(
  routine: RoutineDoc,
  resolved: ResolvedPlacement[],
  overrides: Partial<RoutineStore> = {},
): RoutineStore {
  return {
    readRoutine: () => routine,
    readPlacements: () => resolved,
    openFigure: () => {},
    addSection: () => {},
    renameSection: () => {},
    moveSection: () => {},
    deleteSection: () => {},
    addPlacement: () => {},
    movePlacement: () => {},
    deletePlacement: () => {},
    addBreak: () => {},
    setBreakBeats: () => {},
    setFigureAttributes: () => {},
    setFigureCounts: () => {},
    renameFigure: () => {},
    setFigureAlignment: () => {},
    readAnnotations: () => [],
    createAnnotation: () => {},
    addReply: () => {},
    deleteAnnotation: () => {},
    deleteReply: () => {},
    createCustomKind: () => {},
    customKinds: () => [],
    retryFigure: () => {},
    undo: () => ({ undone: false, supersededByOthers: false }),
    redo: () => {},
    undoFigure: () => ({ undone: false, supersededByOthers: false }),
    redoFigure: () => {},
    subscribe: () => () => {},
    syncState: () => "live",
    close: () => {},
    ...overrides,
  };
}

const placement = (id: string, figureRef: string): Placement => ({
  id,
  figureRef,
  deletedAt: null,
});
const figure = (id: string, name: string): FigureDoc => ({
  id,
  scope: "global",
  ownerId: "u",
  figureType: id,
  dance: "foxtrot",
  name,
  source: "library",
  attributes: [{ id: `${id}-a1`, kind: "rise", count: 1, value: "rise", deletedAt: null }],
  entryAlignment: { qualifier: "facing", direction: "DW" },
  schemaVersion: 1,
  deletedAt: null,
});

describe("Reading view (read-only routine timeline)", () => {
  it("toggles to a read-only timeline showing figures and their step chips", async () => {
    // Intent: a view toggle lays the whole routine out as a read-only timeline —
    //   every figure's notated steps as chips — the payoff view (US-018 reading).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const p = placement("p1", "feather");
    const fig: FigureDoc = {
      ...figure("feather", "Feather"),
      attributes: [{ id: "a1", kind: "step", count: 2, value: "T", role: null, deletedAt: null }],
    };
    const routine: RoutineDoc = {
      id: "rt_sample",
      title: "Sample",
      dance: "foxtrot",
      ownerId: "u",
      sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, [{ placement: p, figure: fig, status: "live" }])}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /reading view/i }));
    expect(screen.getByTestId("reading-view")).toBeInTheDocument();
    expect(screen.getByText("Feather")).toBeInTheDocument();
    expect(screen.getByText("T")).toBeInTheDocument();
    // Reading mode is read-only — no section-management affordance.
    expect(screen.queryByRole("button", { name: /add section/i })).toBeNull();
    // Toggle back to the editable list view.
    await userEvent.click(screen.getByRole("button", { name: /list view/i }));
    expect(screen.queryByTestId("reading-view")).toBeNull();
  });

  it("opens on the reading programme when initialMode='read', then toggles to edit", async () => {
    // Intent (design `assembleEdit`): opening an existing routine lands on the
    //   clean reading view first — no editing affordances until the user toggles.
    //   A freshly created routine (initialMode='edit', the default) lands in the
    //   builder. ChoreoFlow chooses: read on open/fork, edit on create/template.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const p = placement("p1", "feather");
    const routine: RoutineDoc = {
      id: "rt_sample",
      title: "Sample",
      dance: "foxtrot",
      ownerId: "u",
      sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        initialMode="read"
        store={fakeStore(routine, [
          { placement: p, figure: figure("feather", "Feather"), status: "live" },
        ])}
      />,
    );
    // Lands in read: the reading programme is shown and editing is hidden even
    // for an editor, until they switch lenses.
    expect(screen.getByTestId("reading-view")).toBeInTheDocument();
    expect(screen.queryByTestId("section-list")).toBeNull();
    // The header offers the read→edit toggle ("List view"); using it reveals the builder.
    await userEvent.click(screen.getByRole("button", { name: /list view/i }));
    expect(screen.queryByTestId("reading-view")).toBeNull();
    expect(screen.getByTestId("section-list")).toBeInTheDocument();
  });
});

describe("Section header bar count (edit view)", () => {
  it("counts a placed-but-un-notated figure's AUTHORED bars, not 0", async () => {
    // Intent (bugfix): a section of figures placed from the catalog but not yet
    //   notated must report their authored `bars`, not "0 bars" — the old code
    //   summed only the phrase span of existing steps and skipped empty figures.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const p1 = placement("p1", "feather");
    const p2 = placement("p2", "threestep");
    // Two figures with an authored length but NO notated attributes yet.
    const emptyFig = (id: string, name: string, bars: number): FigureDoc => ({
      ...figure(id, name),
      bars,
      attributes: [],
    });
    const routine: RoutineDoc = {
      id: "rt_sample",
      title: "Sample",
      dance: "foxtrot",
      ownerId: "u",
      sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p1, p2] }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, [
          { placement: p1, figure: emptyFig("feather", "Feather", 2), status: "live" },
          { placement: p2, figure: emptyFig("threestep", "Three Step", 1), status: "live" },
        ])}
      />,
    );
    // 2 + 1 authored bars = "3 bars" in the section header — never 0.
    expect(screen.getByText("3 bars")).toBeInTheDocument();
    expect(screen.queryByText("0 bars")).toBeNull();
  });
});

describe("Timing lens — counts ⇄ slow/quick (Tango/Foxtrot/Quickstep)", () => {
  // The lens persists to localStorage (bb_timing); isolate each case.
  beforeEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      // no-op — jsdom always has localStorage, but stay defensive.
    }
  });
  const feather = (): FigureDoc => ({
    ...figure("feather", "Feather"),
    bars: 1,
    // SQQ timing → counts 1, 3, 4 (a Slow then two Quicks).
    attributes: [
      { id: "s1", kind: "direction", count: 1, role: null, value: "forward", deletedAt: null },
      { id: "s2", kind: "direction", count: 3, role: null, value: "forward", deletedAt: null },
      { id: "s3", kind: "direction", count: 4, role: null, value: "forward", deletedAt: null },
    ],
  });
  const readingRoutine = (dance: RoutineDoc["dance"]): RoutineDoc => ({
    id: "rt_sample",
    title: "Sample",
    dance,
    ownerId: "u",
    sections: [
      { id: "s1", name: "Intro", deletedAt: null, placements: [placement("p1", "feather")] },
    ],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });

  it("offers the S/Q toggle in the reading view for a Foxtrot and switches counts to slows/quicks", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        initialMode="read"
        store={fakeStore(readingRoutine("foxtrot"), [
          { placement: placement("p1", "feather"), figure: feather(), status: "live" },
        ])}
      />,
    );
    // Counts mode by default: the SQQ figure reads its beat numbers (1 3 4).
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    // Flip to slow/quick.
    await userEvent.click(screen.getByRole("radio", { name: /slows & quicks/i }));
    expect(screen.getAllByText("S").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Q").length).toBeGreaterThan(0);
  });

  it("does NOT offer the S/Q toggle for a Waltz (counts-only dance)", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        initialMode="read"
        store={fakeStore(readingRoutine("waltz"), [
          {
            placement: placement("p1", "feather"),
            figure: { ...feather(), dance: "waltz" },
            status: "live",
          },
        ])}
      />,
    );
    expect(screen.queryByRole("radio", { name: /slows & quicks/i })).toBeNull();
  });
});

describe("US-018 Open & view a routine", () => {
  it("shows sections in order with placement cards (name, badges, summary, chips)", async () => {
    // Intent: opening a routine renders sections → placement cards from the synced docs.
    // Arrange: a sample routine — sections "Intro" (Feather) then "Body" (Three Step).
    // Act: render <Assemble> bound to it. Assert: sections in order as headings; each
    //   placement card shows the figure name + attribute summary + alignment chip.
    // Covers US-018 AC-1 (sections in order with placement cards).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const routine: RoutineDoc = {
      id: "rt_sample",
      title: "Sample",
      dance: "foxtrot",
      ownerId: "u",
      sections: [
        { id: "s1", name: "Intro", deletedAt: null, placements: [placement("p1", "feather")] },
        { id: "s2", name: "Body", deletedAt: null, placements: [placement("p2", "threestep")] },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    const resolved: ResolvedPlacement[] = [
      {
        placement: placement("p1", "feather"),
        figure: figure("feather", "Feather"),
        status: "live",
      },
      {
        placement: placement("p2", "threestep"),
        figure: figure("threestep", "Three Step"),
        status: "live",
      },
    ];
    const { container } = renderUi(
      <Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />,
    );

    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(expect.arrayContaining(["Intro", "Body"]));
    expect(headings.indexOf("Intro")).toBeLessThan(headings.indexOf("Body")); // in order
    expect(screen.getByText("Feather")).toBeInTheDocument();
    expect(screen.getByText("Three Step")).toBeInTheDocument();
    // The placement card shows the figure's attributes as chips (US-018): the
    // fixture's rise value renders as a "rise" chip on both cards.
    expect(screen.getAllByText("rise").length).toBeGreaterThan(0); // attribute chip
    expect(screen.getAllByText(/entry/i).length).toBeGreaterThan(0); // alignment chip
    expect(await axeCheck(container)).toHaveNoViolations(); // a11y smoke (DESIGN-PRINCIPLES)
  });

  it("shows a clear 'you're offline' state for data when offline", async () => {
    // Intent: online-first — data shows an explicit offline state (no silent stale edits).
    // Arrange: render <Assemble> with the connection reported offline.
    // Act/Assert: an "offline" notice is visible.
    // Covers US-018 AC-3 (offline data state).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(<Assemble routineId="rt_sample" role="viewer" connection="offline" />);
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });
});

describe("US-026 Add / rename / reorder / delete sections", () => {
  /** A routine with two sections, for exercising reorder + per-section controls. */
  const twoSectionRoutine = (): RoutineDoc => ({
    id: "rt_sample",
    title: "Sample",
    dance: "foxtrot",
    ownerId: "u",
    sections: [
      { id: "s1", name: "Intro", deletedAt: null, placements: [] },
      { id: "s2", name: "Body", deletedAt: null, placements: [] },
    ],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });

  it("lets an editor add, rename, reorder, and soft-delete (with confirm) sections", async () => {
    // Intent: editors manage user-named sections through the store; delete confirms.
    // Arrange: an editor on a 2-section routine, with store mutations spied.
    // Act/Assert: add (reveals a name input → addSection), rename (→ renameSection),
    //   move down (→ moveSection), delete (→ a confirm dialog → deleteSection).
    // Covers US-026 AC-1 (add/rename/reorder/soft-delete + confirm).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const spies = {
      addSection: vi.fn(),
      renameSection: vi.fn(),
      moveSection: vi.fn(),
      deleteSection: vi.fn(),
    };
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(twoSectionRoutine(), [], spies)}
      />,
    );

    // Add
    await userEvent.click(screen.getByRole("button", { name: /add section/i }));
    const nameInput = screen.getByRole("textbox", { name: /section name/i });
    expect(nameInput).toBeInTheDocument();
    await userEvent.type(nameInput, "Coda");
    await userEvent.click(screen.getByRole("button", { name: /add section/i }));
    expect(spies.addSection).toHaveBeenCalledWith("Coda");

    // Rename "Intro" → "Opening"
    await userEvent.click(screen.getByRole("button", { name: /rename intro/i }));
    const renameInput = screen.getByRole("textbox", { name: /section name/i });
    await userEvent.clear(renameInput);
    await userEvent.type(renameInput, "Opening");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(spies.renameSection).toHaveBeenCalledWith("s1", "Opening");

    // Reorder: move "Intro" down
    await userEvent.click(screen.getByRole("button", { name: /move intro down/i }));
    expect(spies.moveSection).toHaveBeenCalledWith("s1", "down");

    // Soft-delete "Body" — confirm required
    await userEvent.click(screen.getByRole("button", { name: /delete body/i }));
    expect(spies.deleteSection).not.toHaveBeenCalled(); // not until confirmed
    await userEvent.click(screen.getByRole("button", { name: /delete section/i }));
    expect(spies.deleteSection).toHaveBeenCalledWith("s2");
  });

  it("hides section management from a commenter/viewer", async () => {
    // Intent: only editors manage sections (gated on can(role,'canEdit')).
    // Arrange: a commenter on a 2-section routine. Act/Assert: no add/rename/move/delete.
    // Covers US-026 AC-2 (commenter/viewer cannot manage sections).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="commenter"
        store={fakeStore(twoSectionRoutine(), [])}
      />,
    );
    expect(screen.queryByRole("button", { name: /add section/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /rename intro/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move intro down/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete intro/i })).toBeNull();
  });
});

describe("US-027 Add / reorder / delete figure placements", () => {
  /** A section "Intro" with two placements (Feather, Three Step), resolved. */
  const seeded = (): { routine: RoutineDoc; resolved: ResolvedPlacement[] } => {
    const p1 = placement("p1", "feather");
    const p2 = placement("p2", "threestep");
    return {
      routine: {
        id: "rt_sample",
        title: "Sample",
        dance: "foxtrot",
        ownerId: "u",
        sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p1, p2] }],
        annotations: [],
        schemaVersion: 1,
        deletedAt: null,
      },
      resolved: [
        { placement: p1, figure: figure("feather", "Feather"), status: "live" },
        { placement: p2, figure: figure("threestep", "Three Step"), status: "live" },
      ],
    };
  };

  it("lets an editor add a placement, reorder within a section, and soft-delete", async () => {
    // Intent: editors sequence figures via placements (figureRef) within a section.
    // Arrange: an editor on a section with two resolved placements; mutations spied.
    // Act/Assert: the card shows figure name + scope badge + attribute summary +
    //   alignment chip; Add opens a dialog → addPlacement; move down → movePlacement;
    //   remove → a confirm dialog → deletePlacement.
    // Covers US-027 AC-1 (add/reorder/soft-delete) + AC-3 (card content).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const spies = {
      addPlacement: vi.fn(),
      movePlacement: vi.fn(),
      deletePlacement: vi.fn(),
    };
    const { routine, resolved } = seeded();
    renderUi(
      <Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved, spies)} />,
    );

    // AC-3 card content
    expect(screen.getByText("Feather")).toBeInTheDocument();
    expect(screen.getAllByText(/library|custom|variant/i).length).toBeGreaterThan(0); // scope badge
    expect(screen.getAllByText("rise").length).toBeGreaterThan(0); // attribute chip
    expect(screen.getAllByText(/entry/i).length).toBeGreaterThan(0); // alignment chip

    // Add a figure → the picker sheet; create a custom one (no figureType).
    await userEvent.click(screen.getAllByRole("button", { name: /add figure/i })[0] as HTMLElement);
    expect(screen.getByRole("dialog", { name: /add.*figure/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/figure name/i), "Reverse Wave");
    await userEvent.click(screen.getByRole("button", { name: /add custom/i }));
    // The custom form carries a COUNTS stepper (default 3 — Builder v3 ①).
    // Appended (no insert anchor) → trailing beforePlacementId is undefined.
    expect(spies.addPlacement).toHaveBeenCalledWith(
      "s1",
      "Reverse Wave",
      undefined,
      3,
      undefined,
      undefined,
      expect.any(Function), // onCreated — create-navigates (§4.3)
    );

    // Reorder: move "Feather" down within the section
    await userEvent.click(screen.getByRole("button", { name: /move feather down/i }));
    expect(spies.movePlacement).toHaveBeenCalledWith("s1", "p1", "down");

    // Soft-delete "Feather" — confirm required
    await userEvent.click(screen.getByRole("button", { name: /remove feather/i }));
    expect(spies.deletePlacement).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /remove figure/i }));
    expect(spies.deletePlacement).toHaveBeenCalledWith("s1", "p1");
  });

  it("lets an editor insert a figure BETWEEN placements (US-027 insert-between)", async () => {
    // Intent: figures can grow anywhere in the sequence, not just at its end.
    // A ＋ spot sits in the gap before each placement (past the first); tapping
    // it opens the picker and addPlacement carries that placement as the anchor.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const addPlacement = vi.fn();
    const { routine, resolved } = seeded();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, resolved, { addPlacement })}
      />,
    );

    // One insert spot for the two placements (before the 2nd only — index 0 has none).
    const spots = screen.getAllByRole("button", { name: /insert figure here/i });
    expect(spots).toHaveLength(1);
    await userEvent.click(spots[0] as HTMLElement);

    await userEvent.type(screen.getByLabelText(/figure name/i), "Hover");
    await userEvent.click(screen.getByRole("button", { name: /add custom/i }));
    // The anchor is p2 (the placement the ＋ sits before) → inserted before it.
    expect(addPlacement).toHaveBeenCalledWith(
      "s1",
      "Hover",
      undefined,
      3,
      "p2",
      undefined,
      expect.any(Function), // onCreated — create-navigates (§4.3)
    );
  });

  it("lets an editor add a break and step its beats (US-004a)", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const spies = { addPlacement: vi.fn(), setBreakBeats: vi.fn() };
    const brk: Placement = { id: "b1", source: "break", beats: 4, deletedAt: null };
    const routine: RoutineDoc = {
      id: "rt_sample",
      title: "Sample",
      dance: "foxtrot",
      ownerId: "u",
      sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [brk] }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    renderUi(
      <Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, [], spies)} />,
    );

    // The break renders as a muted card showing its beat count.
    const card = screen.getByTestId("break-card");
    expect(card).toHaveTextContent(/4 beats/i);

    // The "add break" affordance now MINTS a choreo-local Break FIGURE
    // (Builder v3 ④): a Foxtrot bar's worth of empty counts, editable like any
    // figure — legacy break placements above keep rendering as cards.
    await userEvent.click(screen.getAllByRole("button", { name: /add break/i })[0] as HTMLElement);
    expect(spies.addPlacement).toHaveBeenCalledWith("s1", "Break", undefined, 4);

    // The −/＋ stepper changes the beat count.
    await userEvent.click(screen.getByRole("button", { name: /more beats/i }));
    expect(spies.setBreakBeats).toHaveBeenCalledWith("s1", "b1", 5);
    await userEvent.click(screen.getByRole("button", { name: /fewer beats/i }));
    expect(spies.setBreakBeats).toHaveBeenCalledWith("s1", "b1", 3);
  });

  it("blocks a non-editor from modifying placements", async () => {
    // Intent: placement editing is editor-only (gated on can(role,'canEdit')).
    // Arrange: a viewer on the seeded section. Act/Assert: no add/move/remove controls.
    // Covers US-027 AC-2 (non-editor cannot modify placements).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = seeded();
    renderUi(<Assemble routineId="rt_sample" role="viewer" store={fakeStore(routine, resolved)} />);
    expect(screen.queryByRole("button", { name: /add figure/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move feather down/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove feather/i })).toBeNull();
  });
});

describe("v5 library bookmark — 'add to my library' affordance (PLAN §4.2/§5.2)", () => {
  /** An ACCOUNT-scope (choreo-local) figure — the only kind the placement card's
   *  bookmark affordance targets (a global/catalog reference bookmarks from the
   *  Library screen's "↟ save" card instead). */
  const accountFigure = (id: string, name: string): FigureDoc => ({
    id,
    scope: "account",
    ownerId: "u",
    figureType: id,
    dance: "foxtrot",
    name,
    source: "custom",
    attributes: [],
    schemaVersion: 1,
    deletedAt: null,
  });

  const seededAccount = (): { routine: RoutineDoc; resolved: ResolvedPlacement[] } => {
    const p1 = placement("p1", "glue1");
    return {
      routine: {
        id: "rt_sample",
        title: "Sample",
        dance: "foxtrot",
        ownerId: "u",
        sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p1] }],
        annotations: [],
        schemaVersion: 1,
        deletedAt: null,
      },
      resolved: [{ placement: p1, figure: accountFigure("glue1", "Glue Step"), status: "live" }],
    };
  };

  it("offers 'add to my library' on a choreo-local ACCOUNT figure, and calls onAddToLibrary with its figureRef", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const onAddToLibrary = vi.fn(async () => ({ alreadySaved: false }));
    const { routine, resolved } = seededAccount();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, resolved)}
        bookmarkedFigureRefs={new Set()}
        onAddToLibrary={onAddToLibrary}
      />,
    );

    const addButton = screen.getByRole("button", { name: /add glue step to my library/i });
    await userEvent.click(addButton);
    expect(onAddToLibrary).toHaveBeenCalledWith("glue1");
    expect(await screen.findByText(/added to your library/i)).toBeInTheDocument();
  });

  it("keeps the 'add to library' affordance off the name's header row so the name isn't crowded to a stub", async () => {
    // Regression: a custom figure crammed the "Custom" pill + the long "add to
    // library" button into the same flex row as the name, collapsing the name to
    // a single truncated character on a narrow screen. The affordances now ride
    // their own row, so the name button and the add button no longer share a parent.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = seededAccount();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, resolved)}
        bookmarkedFigureRefs={new Set()}
        onAddToLibrary={vi.fn(async () => ({ alreadySaved: false }))}
      />,
    );

    const nameButton = screen.getByRole("button", { name: /edit steps: glue step/i });
    const addButton = screen.getByRole("button", { name: /add glue step to my library/i });
    expect(nameButton.parentElement).not.toBe(addButton.parentElement);
    // The pill lives with the button on the affordance row, not on the name row.
    const customPill = screen.getByText("Custom");
    expect(nameButton.parentElement?.contains(customPill)).toBe(false);
  });

  it("shows 'in your library' (no button) once the figure is bookmarked", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const onAddToLibrary = vi.fn();
    const { routine, resolved } = seededAccount();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, resolved)}
        bookmarkedFigureRefs={new Set(["glue1"])}
        onAddToLibrary={onAddToLibrary}
      />,
    );

    expect(screen.getByText(/in your library/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add glue step to my library/i })).toBeNull();
  });

  it("toasts 'already in your library' when re-bookmarking resolves alreadySaved", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const onAddToLibrary = vi.fn(async () => ({ alreadySaved: true }));
    const { routine, resolved } = seededAccount();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, resolved)}
        bookmarkedFigureRefs={new Set()}
        onAddToLibrary={onAddToLibrary}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add glue step to my library/i }));
    expect(await screen.findByText(/already in your library/i)).toBeInTheDocument();
  });

  it("hides the affordance for a non-editor (viewer)", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = seededAccount();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="viewer"
        store={fakeStore(routine, resolved)}
        bookmarkedFigureRefs={new Set()}
        onAddToLibrary={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /add glue step to my library/i })).toBeNull();
  });

  it("hides the affordance entirely when the caller doesn't wire onAddToLibrary", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = seededAccount();
    renderUi(<Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />);
    expect(screen.queryByRole("button", { name: /add glue step to my library/i })).toBeNull();
    expect(screen.queryByText(/in your library/i)).toBeNull();
  });

  it("does NOT offer 'add to my library' for an account figure still matching the global pool", async () => {
    // The requirement: only figures NOT (still) part of the global pool get the
    // bookmark affordance. An account figure whose (dance, figureType, name) +
    // attributes still equal its catalog origin is effectively the pool figure —
    // no button (matches the "custom" badge divergence rule, §2.5.1 #19).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const origin = libraryFiguresForDance("foxtrot")[0];
    if (!origin) throw new Error("expected a foxtrot catalog figure to clone");
    // An account figure that is a byte-for-byte clone of a catalog figure.
    const undivergedAccount: FigureDoc = {
      id: "pool-clone",
      scope: "account",
      ownerId: "u",
      figureType: origin.figureType,
      dance: origin.dance,
      name: origin.name,
      source: "library",
      attributes: (origin.attributes ?? []).map((a) => ({ ...a })),
      schemaVersion: 1,
      deletedAt: null,
    };
    const p1 = placement("p1", "pool-clone");
    const routine: RoutineDoc = {
      id: "rt_sample",
      title: "Sample",
      dance: "foxtrot",
      ownerId: "u",
      sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p1] }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, [{ placement: p1, figure: undivergedAccount, status: "live" }])}
        bookmarkedFigureRefs={new Set()}
        onAddToLibrary={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /to my library/i })).toBeNull();
    // The figure still renders (with its catalog attributes) — only the bookmark
    // affordance is withheld.
    expect(screen.getByText(origin.name)).toBeInTheDocument();
  });
});

describe("US-037 Choreo fork ('make it your own')", () => {
  /** A minimal routine for exercising the fork affordance + lineage badge. */
  const baseRoutine = (overrides: Partial<RoutineDoc> = {}): RoutineDoc => ({
    id: "rt_sample",
    title: "Sample",
    dance: "foxtrot",
    ownerId: "u",
    sections: [],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
    ...overrides,
  });

  it("offers a 'Make a copy' fork affordance that invokes onFork — even for a viewer (AC-1)", async () => {
    // Intent: any member viewing a routine can fork it ("make it your own"); the
    //   affordance calls back to the flow, which clones it server-side. A viewer
    //   (who cannot edit) still gets the fork action.
    // Covers US-037 AC-1 (a fork action exists and triggers the fork).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const onFork = vi.fn();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="viewer"
        store={fakeStore(baseRoutine(), [])}
        onFork={onFork}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /make a copy/i }));
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  it("shows a 'Forked copy' lineage badge only when the routine has a forkedFromRef (AC-3)", async () => {
    // Intent: lineage is surfaced as provenance only — a forked routine shows a
    //   badge; a non-forked one does not. (Frozen-independence is the E2E test.)
    // Covers US-037 AC-3 (lineage shown as provenance).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    // Not a fork → no badge.
    const { unmount } = renderUi(
      <Assemble routineId="rt_sample" role="editor" store={fakeStore(baseRoutine(), [])} />,
    );
    expect(screen.queryByText(/forked copy/i)).toBeNull();
    unmount();
    // A fork (forkedFromRef set) → the lineage badge shows.
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(baseRoutine({ forkedFromRef: "rt_origin" }), [])}
      />,
    );
    expect(screen.getByText(/forked copy/i)).toBeInTheDocument();
  });
});

describe("US-038 Per-user undo / redo UX", () => {
  /** A minimal routine for exercising the undo/redo affordances. */
  const undoRoutine = (): RoutineDoc => ({
    id: "rt_sample",
    title: "Sample",
    dance: "foxtrot",
    ownerId: "u",
    sections: [],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });

  it("lets an editor undo (with an 'Undone' toast) and redo (AC-1 + AC-4)", async () => {
    // Intent: the editor surface exposes per-user undo/redo; undo shows the
    //   "Undone" toast and inverts via the store; redo re-applies via the store.
    //   (The "only my change reverts across two clients" proof is undo.spec.ts.)
    // Covers US-038 AC-1 (Undone toast) + AC-4 (redo).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const spies = { undo: vi.fn(), redo: vi.fn() };
    renderUi(
      <Assemble routineId="rt_sample" role="editor" store={fakeStore(undoRoutine(), [], spies)} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^undo$/i }));
    expect(spies.undo).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/undone/i)).toBeInTheDocument(); // AC-1 toast
    await userEvent.click(screen.getByRole("button", { name: /^redo$/i }));
    expect(spies.redo).toHaveBeenCalledTimes(1); // AC-4 redo
  });

  it("hides undo/redo from a non-editor (viewer)", async () => {
    // Intent: undo/redo are editor-only affordances (gated on can(role,'canEdit')).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(<Assemble routineId="rt_sample" role="viewer" store={fakeStore(undoRoutine(), [])} />);
    expect(screen.queryByRole("button", { name: /^undo$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^redo$/i })).toBeNull();
  });
});

describe("§5.4 figure-editor undo — 'undo follows the surface being edited'", () => {
  // The figure editor's auto-save contract ("no Save button — an undo exists") is
  // only honest if figure edits are undoable THERE: the FULL-SCREEN editor header
  // carries its own Undo/Redo, wired to store.undoFigure/redoFigure (the figure's
  // OWN doc), with the same "Undone" toast contract as the Assemble toolbar.
  const oneFigure = (): { routine: RoutineDoc; resolved: ResolvedPlacement[] } => {
    const p = placement("p1", "feather");
    return {
      routine: {
        id: "rt_sample",
        title: "Sample",
        dance: "foxtrot",
        ownerId: "u",
        sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
        annotations: [],
        schemaVersion: 1,
        deletedAt: null,
      },
      resolved: [{ placement: p, figure: figure("feather", "Feather"), status: "live" }],
    };
  };

  /** The open FULL-SCREEN figure editor, scoped so its header Undo/Redo don't
   *  collide with the Assemble toolbar's routine-level ones (both are in the DOM). */
  const editor = () => within(screen.getByRole("dialog", { name: /steps · feather/i }));

  it("shows Undo/Redo in the editor header and undoes THIS figure's doc with an 'Undone' toast", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const undoFigure = vi.fn(() => ({ undone: true, supersededByOthers: false }));
    const redoFigure = vi.fn();
    const { routine, resolved } = oneFigure();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, resolved, { undoFigure, redoFigure })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*Feather/i }));

    await userEvent.click(editor().getByRole("button", { name: /^undo$/i }));
    // Targets the FIGURE's own doc (§5.4), not the routine.
    expect(undoFigure).toHaveBeenCalledWith("feather");
    expect(await screen.findByText(/^undone$/i)).toBeInTheDocument();

    await userEvent.click(editor().getByRole("button", { name: /^redo$/i }));
    expect(redoFigure).toHaveBeenCalledWith("feather");
  });

  it("softens the toast when a peer had built on the undone figure change (US-038 AC-3)", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const undoFigure = vi.fn(() => ({ undone: true, supersededByOthers: true }));
    const { routine, resolved } = oneFigure();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, resolved, { undoFigure })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*Feather/i }));
    await userEvent.click(editor().getByRole("button", { name: /^undo$/i }));
    expect(await screen.findByText(/others had built on this change/i)).toBeInTheDocument();
  });

  it("disables the editor Undo/Redo until the figure's own live doc has hydrated (load on open)", async () => {
    // Intent (C/E): an undo must never land pre-replay — the header affordance is
    //   gated on the same `fromLiveDoc` readiness as the step grid body.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine } = oneFigure();
    const p = placement("p1", "feather");
    const resolved: ResolvedPlacement[] = [
      { placement: p, figure: figure("feather", "Feather"), status: "live", fromLiveDoc: false },
    ];
    renderUi(<Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />);
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*Feather/i }));
    // The body is still gated (loading), and the header Undo/Redo are disabled.
    expect(editor().getByRole("button", { name: /^undo$/i })).toBeDisabled();
    expect(editor().getByRole("button", { name: /^redo$/i })).toBeDisabled();
  });

  it("hides the editor Undo/Redo from a viewer (read-only figure editor)", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = oneFigure();
    renderUi(<Assemble routineId="rt_sample" role="viewer" store={fakeStore(routine, resolved)} />);
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*Feather/i }));
    expect(editor().queryByRole("button", { name: /^undo$/i })).toBeNull();
    expect(editor().queryByRole("button", { name: /^redo$/i })).toBeNull();
  });
});

describe("Builder v3 ③ portion window — the editor windows to the placed slice (§4.3/§4.4)", () => {
  // A 6-count Natural Turn placed as ONLY counts 4–6: the editor must show and
  // edit just that slice — not the whole figure — the reported confusion ("I added
  // 3 steps but the editor gives me all 6").
  const portioned = (): { routine: RoutineDoc; resolved: ResolvedPlacement[] } => {
    const p: Placement = {
      id: "p1",
      figureRef: "nt",
      part: { fromCount: 4, toCount: 6 },
      deletedAt: null,
    };
    const fig: FigureDoc = {
      id: "nt",
      scope: "global",
      ownerId: "app",
      figureType: "natural-turn",
      dance: "foxtrot",
      name: "Natural Turn",
      source: "library",
      counts: 6,
      attributes: [{ id: "b1", kind: "step", count: 1, value: "HT", role: null, deletedAt: null }],
      schemaVersion: 1,
      deletedAt: null,
    };
    return {
      routine: {
        id: "rt_sample",
        title: "Sample",
        dance: "foxtrot",
        ownerId: "u",
        sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
        annotations: [],
        schemaVersion: 1,
        deletedAt: null,
      },
      resolved: [{ placement: p, figure: fig, status: "live" }],
    };
  };
  const editor = () => within(screen.getByRole("dialog", { name: /steps · natural turn/i }));

  it("shows only counts 4–6 (not the un-placed 1–3) and labels the portion", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = portioned();
    renderUi(<Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />);
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*natural turn/i }));
    expect(editor().getByRole("button", { name: /^Add Step at count 4$/i })).toBeInTheDocument();
    expect(editor().getByRole("button", { name: /^Add Step at count 6$/i })).toBeInTheDocument();
    expect(editor().queryByRole("button", { name: /^Add Step at count 1$/i })).toBeNull();
    expect(editor().queryByRole("button", { name: /^Add Step at count 3$/i })).toBeNull();
    expect(editor().getByText(/4–6 of 6/)).toBeInTheDocument();
  });

  it("surfaces the inline 'making this figure yours…' pending state while the fork is in flight", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = portioned();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, resolved, { isForking: () => true })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*natural turn/i }));
    expect(editor().getByText(/making this figure yours/i)).toBeInTheDocument();
  });
});

describe("US-027 Add a figure from the library picker", () => {
  const emptySectionRoutine = (): RoutineDoc => ({
    id: "rt_sample",
    title: "Sample",
    dance: "foxtrot",
    ownerId: "u",
    sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [] }],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });

  it("adds a library preset with its canonical name + figureType (dance-scoped)", async () => {
    // Intent: 'Add figure' is a real library picker — picking a Foxtrot preset
    //   places it carrying the catalog's canonical name AND figureType identity.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const addPlacement = vi.fn();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(emptySectionRoutine(), [], { addPlacement })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^add figure$/i }));
    await userEvent.click(screen.getByRole("button", { name: /feather step/i }));
    // The portion picker (Builder v3 ③) opens; the default range is the whole
    // figure — confirming adds a live catalog reference with no part window.
    await userEvent.click(screen.getByRole("button", { name: /add to choreo/i }));
    expect(addPlacement).toHaveBeenCalledWith(
      "s1",
      "Feather Step",
      "feather-step",
      undefined,
      undefined,
      null,
      expect.any(Function), // onCreated — the STORE decides it never fires for a catalog pick
    );
  });

  it("still supports creating a custom figure by name", async () => {
    // Intent: the picker keeps a 'create your own' escape hatch (no figureType →
    //   the store slugs one). Covers US-027 custom-add alongside the library.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const addPlacement = vi.fn();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(emptySectionRoutine(), [], { addPlacement })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^add figure$/i }));
    await userEvent.type(screen.getByLabelText(/figure name/i), "My Move");
    await userEvent.click(screen.getByRole("button", { name: /add custom/i }));
    // The custom form's counts stepper defaults to 3 (Builder v3 ①).
    expect(addPlacement).toHaveBeenCalledWith(
      "s1",
      "My Move",
      undefined,
      3,
      undefined,
      undefined,
      expect.any(Function), // onCreated — create-navigates (§4.3)
    );
  });
});

describe("Builder v3 ③ — a portioned placement shows ONLY its window", () => {
  it("windows the placement card's timing + technique chips to [fromCount, toCount]", async () => {
    // Intent: adding "the last 3 steps of a Natural Turn" must show only those
    //   steps in the builder card — not the whole figure with a "steps 4–6" label
    //   bolted on. The card's chips must match the reading view's windowing.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    // A charted figure with a distinctive direction on counts 1 and 5.
    const fig: FigureDoc = {
      ...figure("natural-turn", "Natural Turn"),
      attributes: [
        { id: "n1", kind: "direction", count: 1, value: "zzz1", role: null, deletedAt: null },
        { id: "n5", kind: "direction", count: 5, value: "zzz5", role: null, deletedAt: null },
      ],
    };
    // Place only counts 4–6 (the last 3).
    const p: Placement = { ...placement("p1", "natural-turn"), part: { fromCount: 4, toCount: 6 } };
    const routine: RoutineDoc = {
      id: "rt_sample",
      title: "Sample",
      dance: "foxtrot",
      ownerId: "u",
      sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, [{ placement: p, figure: fig, status: "live" }])}
      />,
    );
    // The in-window step (count 5) renders; the out-of-window step (count 1) does not.
    expect(screen.getByText("zzz5")).toBeInTheDocument();
    expect(screen.queryByText("zzz1")).toBeNull();
  });
});

describe("US-028 Notate a figure from the Assemble screen (the hero flow)", () => {
  /** A routine with one section holding one placement → a resolved Feather figure. */
  const oneFigureRoutine = (): { routine: RoutineDoc; resolved: ResolvedPlacement[] } => {
    const p = placement("p1", "feather");
    return {
      routine: {
        id: "rt_sample",
        title: "Sample",
        dance: "foxtrot",
        ownerId: "u",
        sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
        annotations: [],
        schemaVersion: 1,
        deletedAt: null,
      },
      resolved: [{ placement: p, figure: figure("feather", "Feather"), status: "live" }],
    };
  };

  it("shows a loading placeholder, not 'Unknown figure', while a placement's figure resolves", async () => {
    // Intent: a just-placed figure's per-document connection hydrates asynchronously,
    //   so its resolved figure is briefly null. A placement always references a real
    //   (server-created) figure, so null means LOADING, never missing — show a
    //   skeleton/loading state, not the alarming "Unknown figure".
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const p = placement("p1", "feather");
    const routine: RoutineDoc = {
      id: "rt_sample",
      title: "Sample",
      dance: "foxtrot",
      ownerId: "u",
      sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    const resolved: ResolvedPlacement[] = [{ placement: p, figure: null, status: "loading" }];
    renderUi(<Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />);
    expect(screen.queryByText(/unknown figure/i)).toBeNull();
    expect(screen.getByText(/loading figure/i)).toBeInTheDocument();
  });

  it("shows an honest 'unavailable' note for a genuinely missing figure", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const p = placement("p1", "fgone");
    const routine: RoutineDoc = {
      id: "rt_sample",
      title: "Sample",
      dance: "foxtrot",
      ownerId: "u",
      sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    const resolved: ResolvedPlacement[] = [{ placement: p, figure: null, status: "missing" }];
    renderUi(<Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />);
    expect(screen.queryByText(/loading figure/i)).toBeNull();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });

  it("offers Retry for a figure that failed to load, calling store.retryFigure", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const p = placement("p1", "ferr");
    const routine: RoutineDoc = {
      id: "rt_sample",
      title: "Sample",
      dance: "foxtrot",
      ownerId: "u",
      sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    const retryFigure = vi.fn();
    const resolved: ResolvedPlacement[] = [{ placement: p, figure: null, status: "error" }];
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, resolved, { retryFigure })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retryFigure).toHaveBeenCalledWith("ferr");
  });

  it("opens a placement's step editor and persists an attribute edit via the store (AC-1)", async () => {
    // Intent: the hero flow — an editor opens a figure's step timeline from Assemble,
    //   taps a count, picks a value, and the edit is written to THAT figure's doc.
    // Covers US-028 AC-1 wired end-to-end through the store seam (setFigureAttributes).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const setFigureAttributes = vi.fn();
    const { routine, resolved } = oneFigureRoutine();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, resolved, { setFigureAttributes })}
      />,
    );
    // Open the step editor for the Feather placement.
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*Feather/i }));
    // The counts-driven grid shows; tap the empty Step cell at count 1 — the
    // Builder v3 ② quick-add places a blank step (presence direction attr)
    // straight through the store, no overlay needed.
    await userEvent.click(screen.getByRole("button", { name: /Step at count 1$/i }));
    expect(setFigureAttributes).toHaveBeenCalled();
    const [figureRef, attrs] = setFigureAttributes.mock.calls.at(-1) as [string, Attribute[]];
    expect(figureRef).toBe("feather");
    expect(attrs.some((a) => a.kind === "direction" && a.value === null && a.count === 1)).toBe(
      true,
    );
  });

  it("waits for the figure's own live doc before showing the editor (load on open, no flicker)", async () => {
    // Intent (C/E): for an EDITOR, the step editor must not render — then swap out
    //   — stale snapshot content. While the figure is still served by the read-only
    //   snapshot fallback (fromLiveDoc:false), the sheet shows a load state; the
    //   step grid appears once the figure's own live doc has hydrated.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine } = oneFigureRoutine();
    const p = placement("p1", "feather");
    const resolved: ResolvedPlacement[] = [
      { placement: p, figure: figure("feather", "Feather"), status: "live", fromLiveDoc: false },
    ];
    renderUi(<Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />);
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*Feather/i }));
    // The sheet is open but gated: a load state, NOT the editable step grid.
    expect(screen.queryByRole("table", { name: /step grid/i })).toBeNull();
    expect(screen.getByText(/loading figure/i)).toBeInTheDocument();
  });

  it("lets a viewer open the step editor read-only (no value-edit affordance)", async () => {
    // Intent: viewers/commenters can READ a figure's notation but not edit it.
    // Covers US-028 AC-4 (read-only for non-editors), surfaced from Assemble.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = oneFigureRoutine();
    renderUi(<Assemble routineId="rt_sample" role="viewer" store={fakeStore(routine, resolved)} />);
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*Feather/i }));
    // The read grid opens, but a viewer gets no add/edit cell buttons and no bars
    // stepper — there is no way to open the single-attribute editor.
    expect(screen.getByRole("table", { name: /step grid/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /at count/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /increase bars/i })).toBeNull();
  });
});

describe("US-031 Edit per-figure alignment", () => {
  /** A routine with one placement → a Feather figure carrying entry = facing/DW. */
  const alignedRoutine = (): { routine: RoutineDoc; resolved: ResolvedPlacement[] } => {
    const p = placement("p1", "feather");
    return {
      routine: {
        id: "rt_sample",
        title: "Sample",
        dance: "foxtrot",
        ownerId: "u",
        sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
        annotations: [],
        schemaVersion: 1,
        deletedAt: null,
      },
      resolved: [{ placement: p, figure: figure("feather", "Feather"), status: "live" }],
    };
  };

  it("edits a figure's entry alignment (qualifier + direction) via the store (AC-1)", async () => {
    // Intent: an editor sets a figure's entry/exit facing-direction from the step
    //   sheet; the change writes to the figure's doc through the store seam.
    //   D6: alignment editor now uses chip toggles (QUALIFIER + DIRECTION rows).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const setFigureAlignment = vi.fn();
    const { routine, resolved } = alignedRoutine();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, resolved, { setFigureAlignment })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*Feather/i }));
    const entryGroup = screen.getByRole("group", { name: /entry alignment/i });
    expect(entryGroup).toBeInTheDocument();
    // Click the "LOD" direction chip inside the entry alignment fieldset.
    await userEvent.click(within(entryGroup).getByRole("button", { name: /^LOD$/i }));
    expect(setFigureAlignment).toHaveBeenCalledWith("feather", "entry", {
      qualifier: "facing",
      direction: "LOD",
    });
  });

  it("renders an alignment chip on the placement card (AC-2)", async () => {
    // Intent: a figure's set alignment shows as a read-only chip on its card.
    //   D6: chip shows qualifier + readable direction label ("entry facing diag wall").
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = alignedRoutine();
    renderUi(<Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />);
    // entryAlignment = { qualifier: "facing", direction: "DW" } → "entry facing diag wall"
    expect(screen.getByText(/entry facing diag wall/i)).toBeInTheDocument();
  });

  it("has no separate floor / long / short / corner concept (AC-3)", async () => {
    // Intent: per-figure alignment replaces any floor/side model.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = alignedRoutine();
    renderUi(<Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />);
    expect(screen.queryByText(/long side|short side|corner/i)).toBeNull();
  });

  it("hides alignment editing from a viewer", async () => {
    // Intent: alignment editing is editor-only; a viewer sees chips, not selects.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = alignedRoutine();
    renderUi(<Assemble routineId="rt_sample" role="viewer" store={fakeStore(routine, resolved)} />);
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*Feather/i }));
    expect(screen.queryByRole("group", { name: /entry alignment/i })).toBeNull();
  });

  it("D6: shows alignment header summary chips ('facing DW → backing LOD') in the step sheet", async () => {
    // Intent (D6 design 1.20 pin 1): when a figure has entry + exit alignment set,
    //   the notation sheet shows a compact "facing X → backing Y" header summary.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const p = placement("p1", "feather");
    const fig: FigureDoc = {
      ...figure("feather", "Feather"),
      entryAlignment: { qualifier: "facing", direction: "DW" },
      exitAlignment: { qualifier: "backing", direction: "LOD" },
    };
    const routine: RoutineDoc = {
      id: "rt_sample",
      title: "Sample",
      dance: "foxtrot",
      ownerId: "u",
      sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    };
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(routine, [{ placement: p, figure: fig, status: "live" }])}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*Feather/i }));
    // Header summary chips appear in the notation sheet (may also appear on placement card).
    // Use getAllByText to tolerate both occurrences (placement card + header summary).
    expect(screen.getAllByText(/facing diag wall/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/backing LOD/i).length).toBeGreaterThan(0);
  });
});

describe("D5 'Make it mine' fork banner (read mode, design 1.19)", () => {
  const viewerRoutine = (): RoutineDoc => ({
    id: "rt_sample",
    title: "Golden Waltz",
    dance: "waltz",
    ownerId: "other",
    sections: [],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });

  it("shows a fork banner in read mode when viewer cannot edit but can fork", async () => {
    // Intent: a read-only viewer (no canEdit) who has an onFork prop sees the
    //   'Make it mine' banner — the primary fork CTA for the Golden Waltz sample.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const onFork = vi.fn();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="viewer"
        initialMode="read"
        store={fakeStore(viewerRoutine(), [])}
        onFork={onFork}
      />,
    );
    expect(screen.getByText(/viewing a read-only choreo/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /make it mine/i }));
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  it("does NOT show the fork banner in edit mode", async () => {
    // Intent: the banner is read-mode only — not shown in the edit view.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const onFork = vi.fn();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="viewer"
        initialMode="edit"
        store={fakeStore(viewerRoutine(), [])}
        onFork={onFork}
      />,
    );
    expect(screen.queryByText(/viewing a read-only choreo/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /make it mine/i })).toBeNull();
  });

  it("does NOT show the fork banner for an editor (canEdit=true)", async () => {
    // Intent: an editor already has full edit rights — no fork banner needed.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const onFork = vi.fn();
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        initialMode="read"
        store={fakeStore(viewerRoutine(), [])}
        onFork={onFork}
      />,
    );
    expect(screen.queryByText(/viewing a read-only choreo/i)).toBeNull();
  });
});

describe("D7 Undo/redo glyphs (design 1.21)", () => {
  const undoRoutine = (): RoutineDoc => ({
    id: "rt_sample",
    title: "Sample",
    dance: "foxtrot",
    ownerId: "u",
    sections: [],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });

  it("renders ↶ glyph on the Undo button and ↷ on Redo, accessible names intact", async () => {
    // Intent (D7 design 1.21): undo/redo show the glyph characters visually while
    //   keeping 'Undo' / 'Redo' as aria-labels so AT reads them correctly.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(<Assemble routineId="rt_sample" role="editor" store={fakeStore(undoRoutine(), [])} />);
    const undoBtn = screen.getByRole("button", { name: /^undo$/i });
    const redoBtn = screen.getByRole("button", { name: /^redo$/i });
    expect(undoBtn).toBeInTheDocument();
    expect(redoBtn).toBeInTheDocument();
    // Glyphs are present in the button text content.
    expect(undoBtn.textContent).toContain("↶");
    expect(redoBtn.textContent).toContain("↷");
  });
});

describe("Offline editing states (PLAN §11.2, design 1.24)", () => {
  const offlineRoutine = (): RoutineDoc => ({
    id: "rt_sample",
    title: "Offline Waltz",
    dance: "waltz",
    ownerId: "u",
    sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [] }],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });

  it("keeps editing ENABLED while hydrated from local persistence ('local')", async () => {
    // Intent (§11.2): the edit gate is live ∨ local — a doc hydrated from
    //   IndexedDB while disconnected stays editable; edits persist + replay.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore({ ...offlineRoutine(), sections: [] }, [], {
          syncState: () => "local",
        })}
      />,
    );
    // The editor affordances render: the empty-state add-section CTA and the
    // per-user Undo — both gated on canEdit, which must hold in "local".
    expect(screen.getByRole("button", { name: "Add section" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^undo$/i })).toBeInTheDocument();
  });

  it("shows the pending chip (slate, role=status) with the live §11.2 count", async () => {
    // Intent (§11.2 truth-telling / design 1.24 pin 1): ≥1 undelivered change
    //   while unsynced → the visible "will sync" chip with the count.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(offlineRoutine(), [], {
          syncState: () => "local",
          pendingSyncCount: () => 2,
        })}
      />,
    );
    const chip = screen.getByTestId("pending-sync");
    expect(chip).toHaveAttribute("role", "status");
    expect(chip.textContent).toMatch(/2 changes saved on this device/i);
  });

  it("hides the pending chip once everything synced (live, 0 pending)", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(offlineRoutine(), [], {
          syncState: () => "live",
          pendingSyncCount: () => 0,
        })}
      />,
    );
    expect(screen.queryByTestId("pending-sync")).toBeNull();
  });

  it("surfaces terminally-rejected offline edits as an ALERT and keeps content readable", async () => {
    // Intent (§11.2 forbidden outcome, Q-NEW-2 / design 1.24 pin 2): reconnect
    //   terminally rejected (access revoked) with pending edits → an unmissable
    //   role=alert notice; the local content stays on screen (read-only), it is
    //   NOT blanked away behind the full-screen offline state.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(offlineRoutine(), [], {
          syncState: () => "closed",
          pendingSyncCount: () => 2,
        })}
      />,
    );
    const alert = screen.getByTestId("unsynced-changes");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toMatch(/couldn't be saved/i);
    // Content readable; editing disabled (closed is not an editable state).
    expect(screen.getByText("Offline Waltz")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add section" })).toBeNull();
  });

  it("disables the fork affordance while offline (creation is a server action, §11.2)", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    try {
      const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
      renderUi(
        <Assemble
          routineId="rt_sample"
          role="editor"
          onFork={() => {}}
          store={fakeStore(offlineRoutine(), [], { syncState: () => "local" })}
        />,
      );
      expect(screen.getByRole("button", { name: /make a copy/i })).toBeDisabled();
    } finally {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    }
  });

  it("keeps the calm full-screen offline state when closed with NOTHING pending", async () => {
    // Terminal close with no local edits at stake — the pre-§11.2 behavior.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(offlineRoutine(), [], {
          syncState: () => "closed",
          pendingSyncCount: () => 0,
        })}
      />,
    );
    expect(screen.queryByTestId("unsynced-changes")).toBeNull();
    expect(screen.queryByText("Offline Waltz")).toBeNull(); // replaced by OfflineState
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Steps-overlay lens split + create-navigates (2026-07-08 owner request):
//  • EDIT lens → the figure detail is notation-only: no annotation/family-notes
//    panels (they stay on the reading-lens-opened detail), recap text present.
//  • READING lens → the detail keeps the notes surfaces but drops the per-count
//    text recap (the grid/chips are the reading content).
//  • Creating a NEW custom figure opens its step editor immediately.
// ─────────────────────────────────────────────────────────────────────────
describe("Steps overlay — lens-dependent notes/recap + create-opens-editor", () => {
  const overlayRoutine = (p: Placement): RoutineDoc => ({
    id: "rt_sample",
    title: "Sample",
    dance: "foxtrot",
    ownerId: "u",
    sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });

  it("EDIT lens: the step editor hides the notes panels but keeps the per-count recap", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const p = placement("p1", "feather");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(overlayRoutine(p), [
          { placement: p, figure: figure("feather", "Feather"), status: "live" },
        ])}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /edit steps: feather/i }));
    // The authoring summary (the readable per-count recap) stays in the edit lens…
    expect(screen.getByTestId("step-detail-1")).toBeInTheDocument();
    // …but the notes surfaces don't render while editing the choreo.
    expect(screen.queryByRole("region", { name: /^annotations$/i })).toBeNull();
    expect(screen.queryByRole("region", { name: /family notes/i })).toBeNull();
  });

  it("READING lens: the step editor shows the notes panels but hides the recap text", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const p = placement("p1", "feather");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        initialMode="read"
        store={fakeStore(overlayRoutine(p), [
          { placement: p, figure: figure("feather", "Feather"), status: "live" },
        ])}
      />,
    );
    // Open the figure detail from the reading programme (tap the figure name).
    await userEvent.click(
      within(screen.getByTestId("reading-view")).getByRole("button", { name: /^feather$/i }),
    );
    expect(await screen.findByRole("region", { name: /^annotations$/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /family notes/i })).toBeInTheDocument();
    // The text recap is an authoring aid — not shown when viewing.
    expect(screen.queryByTestId("step-detail-1")).toBeNull();
  });

  it("creating a custom figure opens its step editor immediately", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    // The store invokes onCreated synchronously (the real store fires it as soon
    // as a NEW custom figure doc is minted; a catalog pick never fires it).
    const addPlacement = vi.fn(
      (
        _sectionId: string,
        _name: string,
        _figureType?: string,
        _counts?: number,
        _before?: string | null,
        _part?: { fromCount: number; toCount: number } | null,
        onCreated?: (created: { figureRef: string; placementId: string }) => void,
      ) => {
        onCreated?.({ figureRef: "fig_new", placementId: "p_new" });
      },
    );
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(
          {
            id: "rt_sample",
            title: "Sample",
            dance: "foxtrot",
            ownerId: "u",
            sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [] }],
            annotations: [],
            schemaVersion: 1,
            deletedAt: null,
          },
          [],
          { addPlacement },
        )}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^add figure$/i }));
    await userEvent.type(screen.getByLabelText(/figure name/i), "My Move");
    await userEvent.click(screen.getByRole("button", { name: /add custom/i }));
    // The new figure's full-screen step editor opens without another tap (it
    // shows the loading state until the figure doc hydrates).
    expect(await screen.findByRole("dialog", { name: /steps ·/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Figure detail read view (design `figMode`, Builder v3 — openFigure picks the
// detail lens from the assemble lens): the READING programme opens a figure
// READ-ONLY — comments stay (addable per role), but nothing is editable until
// the explicit pencil toggle (editors only) flips the open detail into the
// editing lens. The builder's placement card still opens the editor directly.
// ─────────────────────────────────────────────────────────────────────────
describe("Figure detail read view — reading lens opens read-only, edit is explicit", () => {
  const detailRoutine = (p: Placement): RoutineDoc => ({
    id: "rt_sample",
    title: "Sample",
    dance: "foxtrot",
    ownerId: "u",
    sections: [{ id: "s1", name: "Intro", deletedAt: null, placements: [p] }],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });
  const detail = () => within(screen.getByRole("dialog", { name: /steps · feather/i }));
  const openFromReading = async () =>
    userEvent.click(
      within(screen.getByTestId("reading-view")).getByRole("button", { name: /^feather$/i }),
    );
  const renderReading = async (role: string) => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const p = placement("p1", "feather");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role={role}
        initialMode="read"
        store={fakeStore(detailRoutine(p), [
          { placement: p, figure: figure("feather", "Feather"), status: "live" },
        ])}
      />,
    );
  };

  it("an EDITOR's reading-lens detail is read-only, with an explicit Edit toggle", async () => {
    await renderReading("editor");
    await openFromReading();
    // The notes surfaces are the read view's content…
    expect(await screen.findByRole("region", { name: /^annotations$/i })).toBeInTheDocument();
    // …and NOTHING is editable: no cell add/edit affordances, no editing chrome.
    expect(detail().queryByRole("button", { name: /at count/i })).toBeNull();
    expect(detail().queryByRole("button", { name: /^undo$/i })).toBeNull();
    expect(detail().queryByRole("button", { name: /^redo$/i })).toBeNull();
    expect(detail().queryByRole("heading", { name: /^alignment$/i })).toBeNull();
    expect(detail().queryByRole("button", { name: /^add kind$/i })).toBeNull();
    // The explicit route into editing is the pencil toggle (design figMode).
    expect(detail().getByRole("button", { name: /^edit steps$/i })).toBeInTheDocument();
  });

  it("the Edit toggle flips the OPEN detail into the editing lens (and back)", async () => {
    await renderReading("editor");
    await openFromReading();
    await userEvent.click(detail().getByRole("button", { name: /^edit steps$/i }));
    // Editable now: cell affordances + undo/redo + alignment + add-kind arrive…
    expect(detail().getAllByRole("button", { name: /at count/i }).length).toBeGreaterThan(0);
    expect(detail().getByRole("button", { name: /^undo$/i })).toBeInTheDocument();
    expect(detail().getByRole("heading", { name: /^alignment$/i })).toBeInTheDocument();
    // …the per-count recap (authoring aid) shows, and the notes surfaces leave
    // (the editing lens is notation-only, §4.4).
    expect(detail().getByTestId("step-detail-1")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^annotations$/i })).toBeNull();
    // The toggle flips back to viewing (design onToggleEdit).
    await userEvent.click(detail().getByRole("button", { name: /^view steps$/i }));
    expect(detail().queryByRole("button", { name: /at count/i })).toBeNull();
    expect(await screen.findByRole("region", { name: /^annotations$/i })).toBeInTheDocument();
  });

  it("a COMMENTER can add a note from the read view but gets no Edit toggle", async () => {
    await renderReading("commenter");
    await openFromReading();
    const panel = await screen.findByRole("region", { name: /^annotations$/i });
    expect(within(panel).getByRole("textbox", { name: /^note$/i })).toBeInTheDocument();
    expect(detail().queryByRole("button", { name: /^edit steps$/i })).toBeNull();
    expect(detail().queryByRole("button", { name: /at count/i })).toBeNull();
  });

  it("a VIEWER's read view is fully read-only: no compose, no Edit toggle", async () => {
    await renderReading("viewer");
    await openFromReading();
    const panel = await screen.findByRole("region", { name: /^annotations$/i });
    expect(within(panel).queryByRole("textbox", { name: /^note$/i })).toBeNull();
    expect(detail().queryByRole("button", { name: /^edit steps$/i })).toBeNull();
  });

  it("the BUILDER's placement card still opens the editor directly (edit lens)", async () => {
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const p = placement("p1", "feather");
    renderUi(
      <Assemble
        routineId="rt_sample"
        role="editor"
        store={fakeStore(detailRoutine(p), [
          { placement: p, figure: figure("feather", "Feather"), status: "live" },
        ])}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /edit steps: feather/i }));
    // Immediately editable — no extra toggle tap needed from the builder…
    expect(detail().getAllByRole("button", { name: /at count/i }).length).toBeGreaterThan(0);
    expect(detail().getByRole("button", { name: /^undo$/i })).toBeInTheDocument();
    // …and the pencil offers the way BACK to viewing (design shows it in both modes).
    expect(detail().getByRole("button", { name: /^view steps$/i })).toBeInTheDocument();
  });
});
