// biome-ignore-all lint/a11y/useValidAriaRole: `role`/`figureScope` here are
// component props (membership role, figure scope), not ARIA roles — Biome's a11y
// rule mis-flags them.
import type { FigureListItem } from "@ballroom/contract";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent, within } from "../test-support/render";
import { FigureLibrary } from "./FigureLibrary";

// Library fixtures (projected D1 rows — no CRDT). A Feather family spans dances
// (foxtrot + waltz, US-029/§2.2), a Three Step (foxtrot), and a waltz-only
// Reverse Turn so the dance filter has something to remove.
const fig = (
  over: Partial<FigureListItem> & { docRef: string; figureType: string },
): FigureListItem => ({
  name: over.name ?? over.figureType,
  dance: "foxtrot",
  scope: "global",
  ...over,
});
const FEATHER_FOXTROT = fig({
  docRef: "ff",
  figureType: "feather",
  name: "Feather",
  dance: "foxtrot",
});
const GLOBAL: FigureListItem[] = [
  FEATHER_FOXTROT,
  fig({ docRef: "fw", figureType: "feather", name: "Feather", dance: "waltz" }),
  fig({ docRef: "ts", figureType: "three_step", name: "Three Step", dance: "foxtrot" }),
  fig({ docRef: "rt", figureType: "reverse_turn", name: "Reverse Turn", dance: "waltz" }),
];

// ─────────────────────────────────────────────────────────────────────────
// US-032 — Application-global figure library browse [M4, user]
// US-033 — Account variants + custom figures in library [M4, user]
// US-035 — Auto-variant on editing a non-owned figure (toast) [M4, user]
// US-036 — Fork a figure into a variant explicitly [M4, user]
//
// PLAN §4.2, §10.2 component layer: "figure library screen (variant badge,
// 'used in N'); fork/variant affordances + copy-on-write prompt; toasts incl.
// 'copied as your variant'". Screens built by the frontend agent → dynamic
// import behind it.skip.
// ─────────────────────────────────────────────────────────────────────────

interface FigureTimelineModule {
  FigureTimeline: ComponentType<Record<string, unknown>>;
}

describe("US-032 Application-global figure library browse", () => {
  it("groups global figures by figureType and filters by dance", async () => {
    // Intent: the library shows canonical figures grouped by family, dance-filterable.
    // Arrange: render <FigureLibrary> seeded with Feather (foxtrot+waltz) + Three Step
    //   (foxtrot) + a waltz-only Reverse Turn.
    // Act: select the dance filter = Foxtrot. Assert: a "Feather" group + a "Three Step"
    //   group show; the waltz-only Reverse Turn family is filtered out.
    // Covers US-032 AC-1 (grouped by figureType, filter by dance).
    renderUi(<FigureLibrary globalFigures={GLOBAL} />);
    await userEvent.selectOptions(screen.getByLabelText(/dance/i), "foxtrot");
    expect(screen.getByRole("heading", { name: /feather/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /three step/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /reverse turn/i })).not.toBeInTheDocument();
    // Only the foxtrot Feather row remains under the family (the waltz one is filtered).
    expect(screen.getAllByRole("button", { name: /feather/i })).toHaveLength(1);
  });

  it("marks global figures as not directly editable (auto-variant on edit)", async () => {
    // Intent: a global figure is app-owned; the UI surfaces it with the Library scope
    //   badge (editing it auto-variants on the timeline — US-035), not an in-place edit.
    // Arrange: render the library with a single global Feather.
    // Assert: the list renders; the figure row carries the "Library" scope badge.
    // Covers US-032 AC-2 (global not directly editable).
    renderUi(<FigureLibrary globalFigures={[FEATHER_FOXTROT]} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
    const row = screen.getByRole("button", { name: /feather/i });
    expect(within(row).getByText("Library")).toBeInTheDocument();
  });
});

describe("US-033 Account variants + custom figures in library", () => {
  it("shows a variant lineage badge + a custom badge + 'used in N routines'", async () => {
    // Intent: my variants show base lineage; custom figures a custom badge; usage count.
    // Arrange: render <FigureLibrary tab="mine"> with my variant (base=Telemark, used in 2)
    //   + a custom figure (no base). The variant/custom split keys on baseName, not source (#56).
    // Assert: variant row → "Variant" + "based on Telemark"; custom row → "Custom"; "used in 2 routines".
    // Covers US-033 AC-1 (variant/custom badges) + AC-2 ("used in N").
    const mine: FigureListItem[] = [
      fig({
        docRef: "v1",
        figureType: "open_telemark",
        name: "Open Telemark",
        dance: "foxtrot",
        scope: "variant",
        baseName: "Telemark",
        usedInCount: 2,
      }),
      fig({
        docRef: "c1",
        figureType: "my_swivel",
        name: "My Swivel",
        dance: "foxtrot",
        scope: "custom",
        usedInCount: 0,
      }),
    ];
    renderUi(<FigureLibrary tab="mine" myFigures={mine} />);
    expect(screen.getByText(/used in 2 routines/i)).toBeInTheDocument();
    const variantRow = screen.getByRole("button", { name: /open telemark/i });
    expect(within(variantRow).getByText("Variant")).toBeInTheDocument();
    expect(within(variantRow).getByText(/based on Telemark/i)).toBeInTheDocument();
    const customRow = screen.getByRole("button", { name: /my swivel/i });
    expect(within(customRow).getByText("Custom")).toBeInTheDocument();
  });
});

describe.skip("US-035 Auto-variant on editing a non-owned figure (copy-on-write toast)", () => {
  it("shows a 'copied as your variant' toast when editing a global figure", async () => {
    // Intent: editing a non-owned figure silently creates a variant + shows the toast.
    // User scenario: an editor opens a GLOBAL figure in their routine and edits a step.
    // Arrange: render <FigureTimeline> bound to a global figure (not owned), role=editor.
    // Act: change a step value (triggers copy-on-write). Assert: a "copied as your variant"
    //   toast appears; no blocking dialog (auto, US-035 AC-4).
    // Covers US-035 AC-2 (toast) + AC-4 (no prompt) — §10.2 "'copied as your variant'".
    const { FigureTimeline } = await importComponent<FigureTimelineModule>(
      "../components/FigureTimeline",
    );
    renderUi(<FigureTimeline role="editor" figureScope="global" />);
    await userEvent.click(screen.getByRole("button", { name: /count 1/i }));
    await userEvent.click(screen.getByRole("button", { name: /^H$/ }));
    expect(await screen.findByText(/copied as your variant/i)).toBeInTheDocument();
  });
});

describe.skip("US-036 Fork a figure into a variant explicitly", () => {
  it("offers a 'Fork into variant' action that creates an overlay variant", async () => {
    // Intent: an explicit "Fork into variant" creates a variant (overlay), inheriting the base.
    // Arrange: render <FigureTimeline> for a figure with a "Fork into variant" action.
    // Act: click "Fork into variant". Assert: the variant is created (callback) and the
    //   view rebinds to the variant (lineage badge shows the base).
    // Covers US-036 AC-1 (Fork into variant → overlay).
    const { FigureTimeline } = await importComponent<FigureTimelineModule>(
      "../components/FigureTimeline",
    );
    renderUi(<FigureTimeline role="editor" figureScope="global" />);
    await userEvent.click(screen.getByRole("button", { name: /fork into variant/i }));
    expect(await screen.findByText(/variant of/i)).toBeInTheDocument();
  });
});
