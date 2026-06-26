// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { FigureDoc, Placement, RoutineDoc } from "@ballroom/domain";
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
    addSection: () => {},
    renameSection: () => {},
    moveSection: () => {},
    deleteSection: () => {},
    addPlacement: () => {},
    movePlacement: () => {},
    deletePlacement: () => {},
    setFigureAttributes: () => {},
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

    // Add a figure → a fresh figure + placement
    await userEvent.click(screen.getAllByRole("button", { name: /add figure/i })[0] as HTMLElement);
    expect(screen.getByRole("dialog", { name: /add.*figure/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/figure name/i), "Reverse Wave");
    await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(spies.addPlacement).toHaveBeenCalledWith("s1", "Reverse Wave");

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

describe.skip("US-031 Edit per-figure alignment", () => {
  it("sets entry/exit + per-placement alignment (qualifier + direction)", async () => {
    // Intent: per-figure alignment is editable (entry/exit + optional per-placement).
    // Arrange: open the alignment editor for a placement. Act: set entry = facing/LOD,
    //   exit = backing/wall, and a per-placement override. Assert: the values persist
    //   (onChange called / chips reflect the chosen qualifier+direction).
    // Covers US-031 AC-1 (set entry/exit + per-placement).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(<Assemble routineId="rt_sample" role="editor" />);
    await userEvent.click(screen.getByRole("button", { name: /alignment/i }));
    expect(screen.getByRole("group", { name: /entry alignment/i })).toBeInTheDocument();
  });

  it("renders alignment chips on the placement card and timeline", async () => {
    // Intent: chosen alignment shows as chips.
    // Arrange: render a routine whose placement has entry/exit alignment set.
    // Act/Assert: a chip with the qualifier+direction (e.g. "facing LOD") renders.
    // Covers US-031 AC-2 (alignment chips render).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(<Assemble routineId="rt_sample" role="editor" />);
    expect(screen.getByText(/facing|backing|pointing/i)).toBeInTheDocument();
  });

  it("has no separate floor / long / short / corner concept", async () => {
    // Intent: per-figure alignment suffices; there is no floor model.
    // Arrange: render Assemble. Act/Assert: no long-side/short-side/corner controls.
    // Covers US-031 AC-3 (no floor concept).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(<Assemble routineId="rt_sample" role="editor" />);
    expect(screen.queryByText(/long side|short side|corner/i)).toBeNull();
  });
});
