// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { FigureDoc, Placement, RoutineDoc } from "@ballroom/domain";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
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
function fakeStore(routine: RoutineDoc, resolved: ResolvedPlacement[]): RoutineStore {
  return {
    readRoutine: () => routine,
    readPlacements: () => resolved,
    renameSection: () => {},
    setFigureAttributes: () => {},
    undo: () => {},
    redo: () => {},
    subscribe: () => () => {},
    syncState: () => "live",
    close: () => {},
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

describe.skip("US-026 Add / rename / reorder / delete sections", () => {
  it("lets an editor add, rename, reorder, and soft-delete (with confirm) sections", async () => {
    // Intent: editors manage user-named sections; delete confirms.
    // Arrange: render <Assemble role="editor">. Act: add a section, rename it,
    //   trigger delete → confirm. Assert: the add/rename reflected; delete shows a
    //   confirm dialog before removing.
    // Covers US-026 AC-1 (add/rename/reorder/soft-delete + confirm).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(<Assemble routineId="rt_sample" role="editor" />);
    await userEvent.click(screen.getByRole("button", { name: /add section/i }));
    expect(screen.getByRole("textbox", { name: /section name/i })).toBeInTheDocument();
  });

  it("hides section management from a commenter/viewer", async () => {
    // Intent: only editors manage sections.
    // Arrange: render <Assemble role="commenter">. Act/Assert: no add/rename/delete controls.
    // Covers US-026 AC-2 (commenter/viewer cannot manage sections).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(<Assemble routineId="rt_sample" role="commenter" />);
    expect(screen.queryByRole("button", { name: /add section/i })).toBeNull();
  });
});

describe.skip("US-027 Add / reorder / delete figure placements", () => {
  it("lets an editor add a placement, reorder within a section, and soft-delete", async () => {
    // Intent: editors sequence figures via placements (figureRef) within a section.
    // Arrange: render <Assemble role="editor">. Act: add a placement to "Intro",
    //   reorder it, delete it (confirm). Assert: the card shows figure name + variant/custom
    //   badge + attribute summary + alignment chips; reorder/delete work.
    // Covers US-027 AC-1 (add/reorder/soft-delete) + AC-3 (card content).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(<Assemble routineId="rt_sample" role="editor" />);
    await userEvent.click(screen.getAllByRole("button", { name: /add figure/i })[0] as HTMLElement);
    expect(screen.getByRole("dialog", { name: /add.*figure/i })).toBeInTheDocument();
  });

  it("blocks a non-editor from modifying placements", async () => {
    // Intent: placement editing is editor-only.
    // Arrange: render <Assemble role="viewer">. Act/Assert: no add/reorder/delete controls.
    // Covers US-027 AC-2 (non-editor cannot modify placements).
    const { Assemble } = await importComponent<AssembleModule>("../components/Assemble");
    renderUi(<Assemble routineId="rt_sample" role="viewer" />);
    expect(screen.queryByRole("button", { name: /add figure/i })).toBeNull();
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
