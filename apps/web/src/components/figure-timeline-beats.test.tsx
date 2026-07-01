// biome-ignore-all lint/a11y/useValidAriaRole: `role` is the per-document
// MEMBERSHIP role prop, not an ARIA role.
import type { Attribute } from "@ballroom/domain";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// Notation parity (2026-06-29, frame 1.11 "Figure detail EDIT grid"): the figure
// timeline is a dance-aware COLUMN GRID. Each whole beat is a row with a tappable
// count cell on the left; the columns are every attribute kind applicable to the
// dance. Tapping a count (or a cell) opens the per-count editor; the open
// editor's summary carries the step headline + that count's value chips. The
// dance still scopes the beat ruler (Waltz 3/4 → a 6-beat phrase).
// ─────────────────────────────────────────────────────────────────────────

interface TimelineModule {
  FigureTimeline: ComponentType<Record<string, unknown>>;
}

const attr = (kind: string, value: string, count: number): Attribute => ({
  id: `${kind}-${count}-${value}`,
  kind,
  count,
  value,
  role: null,
  deletedAt: null,
});

const load = () => importComponent<TimelineModule>("../components/FigureTimeline");

describe("FigureTimeline — dance-aware beat-row grid", () => {
  it("lays a Waltz figure out as one 6-beat phrase of count rows", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" />);
    // 6 whole beats (a Waltz phrase), not a flat 8.
    expect(screen.getByRole("button", { name: /^beat 6$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^beat 7$/i })).toBeNull();
  });

  it("shows the dance's applicable kind columns (Tango omits Rise)", async () => {
    const { FigureTimeline } = await load();
    const waltz = renderUi(<FigureTimeline role="editor" dance="waltz" />);
    expect(screen.getByRole("columnheader", { name: /rise/i })).toBeInTheDocument();
    waltz.unmount();
    renderUi(<FigureTimeline role="editor" dance="tango" />);
    expect(screen.queryByRole("columnheader", { name: /rise/i })).toBeNull();
  });

  it("extends past the first phrase to cover an attribute placed later", async () => {
    const { FigureTimeline } = await load();
    // A footwork attribute on count 7 sits in the SECOND Waltz phrase, so the
    // ruler must extend to 12 beats to show its row.
    renderUi(
      <FigureTimeline role="editor" dance="waltz" attributes={[attr("footwork", "ball", 7)]} />,
    );
    expect(screen.getByRole("button", { name: /^beat 7$/i })).toBeInTheDocument();
  });
});

describe("FigureTimeline — opening a count's editor", () => {
  it("opening a count shows a summary with its direction headline + value chips", async () => {
    const { FigureTimeline } = await load();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        attributes={[attr("direction", "forward", 1), attr("footwork", "ball", 1)]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^beat 1$/i }));
    expect(screen.getByTestId("step-headline-1")).toHaveTextContent(/^forward$/i);
    // The count's value chips ride a labelled region (the authoring-journey contract).
    expect(screen.getByLabelText(/count 1 attributes/i)).toHaveTextContent(/ball/i);
  });
});

describe("FigureTimeline — placing steps via the grid", () => {
  it("opens the editor on a count cell and places the attribute there", async () => {
    const { FigureTimeline } = await load();
    const onChange = vi.fn();
    renderUi(<FigureTimeline role="editor" dance="waltz" onChange={onChange} />);
    // Tap beat 2's count cell, then pick footwork — the attribute lands on 2.
    await userEvent.click(screen.getByRole("button", { name: /^beat 2$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Heel-Toe$/ }));
    const added = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find(
      (a) => a.kind === "footwork",
    );
    expect(added?.count).toBe(2);
  });

  it("does not offer add affordances to a viewer (read grid only)", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="viewer" dance="waltz" />);
    // A viewer can tap a count to inspect (read-only editor) but gets no
    // add-cell buttons and no in-between-timing affordance.
    expect(screen.queryByRole("button", { name: /^Add .* at count/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /in-between timing/i })).toBeNull();
  });
});

describe("FigureTimeline — attribute info overlay (frame 1.13)", () => {
  it("tapping a column HEADER opens the kind's info reference (not the editor)", async () => {
    const { FigureTimeline } = await load();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        scopeLabel="Gold Waltz"
        attributes={[attr("rise", "commence", 1)]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^about rise$/i }));
    // The plain-language reference (frame 1.13) opens — its title + usage footer.
    expect(screen.getByRole("heading", { name: /rise & fall/i })).toBeInTheDocument();
    expect(screen.getByText(/used in 1 step across gold waltz/i)).toBeInTheDocument();
  });

  it("the merged Step header describes both direction and footwork", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" />);
    await userEvent.click(screen.getByRole("button", { name: /^about step$/i }));
    expect(screen.getByRole("heading", { name: /^direction$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^footwork$/i })).toBeInTheDocument();
  });
});
