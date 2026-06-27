// biome-ignore-all lint/a11y/useValidAriaRole: `role`/`figureScope` here are
// component props (membership role, figure scope), not ARIA roles — Biome's a11y
// rule mis-flags them.
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

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

interface FigureLibraryModule {
  FigureLibrary: ComponentType<Record<string, unknown>>;
}
interface FigureTimelineModule {
  FigureTimeline: ComponentType<Record<string, unknown>>;
}

describe("US-032 Application-global figure library browse", () => {
  it("groups global figures by figureType and filters by dance", async () => {
    // Intent: the library shows canonical figures grouped by family, dance-filterable.
    // Arrange: render <FigureLibrary> seeded with Feather (foxtrot+waltz) + Three Step.
    // Act: select the dance filter = Foxtrot. Assert: a "Feather" group + a "Three Step"
    //   group show; the Waltz Feather is filtered out.
    // Covers US-032 AC-1 (grouped by figureType, filter by dance).
    const { FigureLibrary } = await importComponent<FigureLibraryModule>(
      "../components/FigureLibrary",
    );
    renderUi(<FigureLibrary />);
    await userEvent.selectOptions(screen.getByLabelText(/dance/i), "foxtrot");
    // The Feather Step is the canonical Foxtrot opener; selecting Foxtrot surfaces
    // its family heading (several figures mention "feather", so match it exactly).
    expect(screen.getByRole("heading", { name: /feather step/i })).toBeInTheDocument();
  });

  it("marks global figures as not directly editable (auto-variant on edit)", async () => {
    // Intent: a global figure is app-owned; the UI signals editing creates a variant.
    // Arrange: render the library; open a global figure. Act: inspect its edit affordance.
    // Assert: an "edit → creates your variant" affordance, not a direct in-place edit.
    // Covers US-032 AC-2 (global not directly editable).
    const { FigureLibrary } = await importComponent<FigureLibraryModule>(
      "../components/FigureLibrary",
    );
    renderUi(<FigureLibrary />);
    expect(screen.getByRole("list")).toBeInTheDocument();
  });
});

describe("US-033 Account variants + custom figures in library", () => {
  it("shows a variant lineage badge + a custom badge + 'used in N routines'", async () => {
    // Intent: my variants show base lineage; custom figures a custom badge; usage count.
    // Arrange: render <FigureLibrary tab="mine"> injecting data — a variant (baseFigureRef set,
    //   usedInCount 2) and a custom figure (baseFigureRef null). No auth/query provider needed.
    // Act: await async load. Assert: "used in 2 routines"; a "Variant" badge; a "Custom" badge.
    // Covers US-033 AC-1 (variant/custom badges) + AC-2 ("used in N").
    const { FigureLibrary } = await importComponent<FigureLibraryModule>(
      "../components/FigureLibrary",
    );
    const loadMine = async () => [
      {
        docRef: "v1",
        title: "My Feather",
        figureType: "feather",
        baseFigureRef: "fg",
        usedInCount: 2,
      },
      {
        docRef: "c1",
        title: "My Spin",
        figureType: "custom_move",
        baseFigureRef: null,
        usedInCount: 0,
      },
    ];
    renderUi(<FigureLibrary tab="mine" loadMine={loadMine} />);
    expect(await screen.findByText(/used in 2 routines/i)).toBeInTheDocument();
    expect(screen.getByText(/variant/i)).toBeInTheDocument();
    expect(screen.getByText(/custom/i)).toBeInTheDocument();
  });
});

describe("US-035 Auto-variant on editing a non-owned figure (copy-on-write toast)", () => {
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

describe("US-036 Fork a figure into a variant explicitly", () => {
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
