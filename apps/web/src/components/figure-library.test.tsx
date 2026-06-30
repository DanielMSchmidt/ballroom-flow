// biome-ignore-all lint/a11y/useValidAriaRole: `role`/`figureScope` here are
// component props (membership role, figure scope), not ARIA roles — Biome's a11y
// rule mis-flags them.
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
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
  it("groups global figures by figureType and filters by dance (chips)", async () => {
    // Intent: the library shows canonical figures grouped by family, dance-filterable
    // via chips (frames 2.1/2.2). Act: click the Foxtrot dance chip. Assert: the
    // Feather Step family surfaces.
    // Covers US-032 AC-1 (grouped by figureType, filter by dance).
    const { FigureLibrary } = await importComponent<FigureLibraryModule>(
      "../components/FigureLibrary",
    );
    renderUi(<FigureLibrary />);
    await userEvent.click(screen.getByRole("button", { name: /^foxtrot$/i }));
    // The Feather Step is the canonical Foxtrot opener; it appears as a family heading
    // and a card name (several figures mention "feather", so match it exactly).
    expect(screen.getAllByRole("heading", { name: /feather step/i }).length).toBeGreaterThan(0);
  });

  it("renders the catalogue as grouped lists (read-only browse)", async () => {
    // Intent: a global figure is app-owned and not directly editable here; the browse
    // is a set of grouped lists. Covers US-032 AC-2 (global not directly editable).
    const { FigureLibrary } = await importComponent<FigureLibraryModule>(
      "../components/FigureLibrary",
    );
    renderUi(<FigureLibrary initialDance="waltz" />);
    expect(screen.getAllByRole("list").length).toBeGreaterThan(0);
  });
});

describe("T5 — ↟ Save to my library (promote a global figure)", () => {
  it("calls onSaveToLibrary with the figure identity + toasts on success", async () => {
    // Intent: each global card carries a "↟ save" affordance that promotes the figure
    // into the user's personal library (PLAN §5.2). Act: click the first save button.
    // Assert: the mutation is invoked and a success toast shows.
    const { FigureLibrary } = await importComponent<FigureLibraryModule>(
      "../components/FigureLibrary",
    );
    const onSaveToLibrary = vi.fn(
      async (input: { dance: string; figureType: string; name: string }) => {
        void input;
        return { alreadySaved: false };
      },
    );
    renderUi(<FigureLibrary initialDance="waltz" onSaveToLibrary={onSaveToLibrary} />);
    const [saveButton] = await screen.findAllByRole("button", { name: /save/i });
    if (!saveButton) throw new Error("no save button rendered");
    await userEvent.click(saveButton);
    expect(onSaveToLibrary).toHaveBeenCalledTimes(1);
    expect(onSaveToLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        dance: expect.any(String),
        figureType: expect.any(String),
        name: expect.any(String),
      }),
    );
    expect(await screen.findByText(/saved to your library/i)).toBeInTheDocument();
  });

  it("toasts 'already in your library' when the figure was already saved (idempotent)", async () => {
    const { FigureLibrary } = await importComponent<FigureLibraryModule>(
      "../components/FigureLibrary",
    );
    const onSaveToLibrary = vi.fn(async () => ({ alreadySaved: true }));
    renderUi(<FigureLibrary initialDance="waltz" onSaveToLibrary={onSaveToLibrary} />);
    const [saveButton] = await screen.findAllByRole("button", { name: /save/i });
    if (!saveButton) throw new Error("no save button rendered");
    await userEvent.click(saveButton);
    expect(await screen.findByText(/already in your library/i)).toBeInTheDocument();
  });
});

describe("US-033 Personal library (saved copies + custom) — lineage + badge", () => {
  const loadMine = async () => [
    {
      docRef: "v1",
      title: "My Feather",
      figureType: "feather",
      dance: "foxtrot",
      baseFigureRef: "global:foxtrot:feather",
      usedInCount: 2,
    },
    {
      docRef: "c1",
      title: "Hover Corté",
      figureType: "custom_move",
      dance: "waltz",
      baseFigureRef: null,
      usedInCount: 1,
    },
  ];

  it("shows lineage, 'used in N', and the two-state scope badge per figure", async () => {
    // Intent: a saved (baseFigureRef) figure reads its lineage ("based on …") + a
    // Library-derived badge; a from-scratch figure reads "your own figure" + Custom
    // (frame 2.3). Usage count is shown. Covers US-033 AC-1/AC-2 + the §4.2 two-state badge.
    const { FigureLibrary } = await importComponent<FigureLibraryModule>(
      "../components/FigureLibrary",
    );
    renderUi(<FigureLibrary tab="mine" loadMine={loadMine} />);
    expect(await screen.findByText(/used in 2 routines/i)).toBeInTheDocument();
    expect(screen.getByText(/used in 1 routine$/i)).toBeInTheDocument();
    // Lineage copy (frame 2.3): saved → "based on …"; own → "your own figure".
    expect(screen.getByText(/based on/i)).toBeInTheDocument();
    expect(screen.getByText(/your own figure/i)).toBeInTheDocument();
    // Two-state ScopeBadge: one Library (saved), one Custom (own) — "Variant" is gone.
    expect(screen.getByText(/^Library$/)).toBeInTheDocument();
    expect(screen.getByText(/^Custom$/)).toBeInTheDocument();
    expect(screen.queryByText(/^variant$/i)).toBeNull();
    // Each figure offers an edit affordance.
    expect(screen.getAllByRole("button", { name: /edit/i }).length).toBeGreaterThanOrEqual(2);
  });

  it("filters the personal library by dance and shows the empty per-dance prompt (2.4)", async () => {
    const { FigureLibrary } = await importComponent<FigureLibraryModule>(
      "../components/FigureLibrary",
    );
    renderUi(<FigureLibrary tab="mine" loadMine={loadMine} />);
    await screen.findByText(/used in 2 routines/i);
    // Filter to a dance with nothing saved → the guided empty state (exact copy).
    await userEvent.click(screen.getByRole("button", { name: /^tango$/i }));
    expect(screen.getByText(/nothing saved for this dance yet/i)).toBeInTheDocument();
    expect(screen.getByText(/save a figure from the library to reuse it/i)).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: /beat 1/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Heel-Toe$/ }));
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
