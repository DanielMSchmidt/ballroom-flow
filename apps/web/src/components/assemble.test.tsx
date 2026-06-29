// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { Attribute, FigureDoc, Placement, RoutineDoc } from "@ballroom/domain";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedPlacement, RoutineStore } from "../store/routine";
import { importComponent } from "../test-support/import-component";
import { axeCheck, renderUi, screen, userEvent } from "../test-support/render";

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
    setFigureAttributes: () => {},
    setFigureAlignment: () => {},
    readAnnotations: () => [],
    createAnnotation: () => {},
    addReply: () => {},
    deleteAnnotation: () => {},
    deleteReply: () => {},
    createCustomKind: () => {},
    customKinds: () => [],
    undo: () => {},
    redo: () => {},
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
        store={fakeStore(routine, [{ placement: p, figure: fig }])}
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
      { placement: placement("p1", "feather"), figure: figure("feather", "Feather") },
      { placement: placement("p2", "threestep"), figure: figure("threestep", "Three Step") },
    ];
    const { container } = renderUi(
      <Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />,
    );

    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(expect.arrayContaining(["Intro", "Body"]));
    expect(headings.indexOf("Intro")).toBeLessThan(headings.indexOf("Body")); // in order
    expect(screen.getByText("Feather")).toBeInTheDocument();
    expect(screen.getByText("Three Step")).toBeInTheDocument();
    expect(screen.getAllByText(/attribute/i).length).toBeGreaterThan(0); // attribute summary
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
    await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
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
        { placement: p1, figure: figure("feather", "Feather") },
        { placement: p2, figure: figure("threestep", "Three Step") },
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
    expect(screen.getAllByText(/attribute/i).length).toBeGreaterThan(0); // attribute summary
    expect(screen.getAllByText(/entry/i).length).toBeGreaterThan(0); // alignment chip

    // Add a figure → the picker sheet; create a custom one (no figureType).
    await userEvent.click(screen.getAllByRole("button", { name: /add figure/i })[0] as HTMLElement);
    expect(screen.getByRole("dialog", { name: /add.*figure/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/figure name/i), "Reverse Wave");
    await userEvent.click(screen.getByRole("button", { name: /add custom/i }));
    expect(spies.addPlacement).toHaveBeenCalledWith("s1", "Reverse Wave", undefined);

    // Reorder: move "Feather" down within the section
    await userEvent.click(screen.getByRole("button", { name: /move feather down/i }));
    expect(spies.movePlacement).toHaveBeenCalledWith("s1", "p1", "down");

    // Soft-delete "Feather" — confirm required
    await userEvent.click(screen.getByRole("button", { name: /remove feather/i }));
    expect(spies.deletePlacement).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /remove figure/i }));
    expect(spies.deletePlacement).toHaveBeenCalledWith("s1", "p1");
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
    expect(addPlacement).toHaveBeenCalledWith("s1", "Feather Step", "feather-step");
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
    expect(addPlacement).toHaveBeenCalledWith("s1", "My Move", undefined);
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
      resolved: [{ placement: p, figure: figure("feather", "Feather") }],
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
    const resolved: ResolvedPlacement[] = [{ placement: p, figure: null }];
    renderUi(<Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />);
    expect(screen.queryByText(/unknown figure/i)).toBeNull();
    expect(screen.getByText(/loading figure/i)).toBeInTheDocument();
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
    // The count timeline shows; tap count 1, then pick footwork "ball".
    await userEvent.click(screen.getByRole("button", { name: /count 1/i }));
    await userEvent.click(screen.getByRole("button", { name: /^ball$/ }));
    expect(setFigureAttributes).toHaveBeenCalled();
    const [figureRef, attrs] = setFigureAttributes.mock.calls.at(-1) as [string, Attribute[]];
    expect(figureRef).toBe("feather");
    expect(attrs.some((a) => a.kind === "footwork" && a.value === "ball" && a.count === 1)).toBe(
      true,
    );
  });

  it("lets a viewer open the step editor read-only (no value-edit affordance)", async () => {
    // Intent: viewers/commenters can READ a figure's notation but not edit it.
    // Covers US-028 AC-4 (read-only for non-editors), surfaced from Assemble.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = oneFigureRoutine();
    renderUi(<Assemble routineId="rt_sample" role="viewer" store={fakeStore(routine, resolved)} />);
    await userEvent.click(screen.getByRole("button", { name: /steps:\s*Feather/i }));
    await userEvent.click(screen.getByRole("button", { name: /count 1/i }));
    expect(screen.queryByRole("button", { name: /^T$/ })).toBeNull();
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
      resolved: [{ placement: p, figure: figure("feather", "Feather") }],
    };
  };

  it("edits a figure's entry alignment (qualifier + direction) via the store (AC-1)", async () => {
    // Intent: an editor sets a figure's entry/exit facing-direction from the step
    //   sheet; the change writes to the figure's doc through the store seam.
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
    expect(screen.getByRole("group", { name: /entry alignment/i })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/entry direction/i), "LOD");
    expect(setFigureAlignment).toHaveBeenCalledWith("feather", "entry", {
      qualifier: "facing",
      direction: "LOD",
    });
  });

  it("renders an alignment chip on the placement card (AC-2)", async () => {
    // Intent: a figure's set alignment shows as a read-only chip on its card.
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    const { routine, resolved } = alignedRoutine();
    renderUi(<Assemble routineId="rt_sample" role="editor" store={fakeStore(routine, resolved)} />);
    expect(screen.getByText(/entry DW/i)).toBeInTheDocument();
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
});
