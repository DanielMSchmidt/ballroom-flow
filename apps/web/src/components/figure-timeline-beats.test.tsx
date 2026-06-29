// biome-ignore-all lint/a11y/useValidAriaRole: `role` is the per-document
// MEMBERSHIP role prop, not an ARIA role.
import type { Attribute } from "@ballroom/domain";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// Notation parity (2026-06-28, .pen FigureEditor): the figure timeline is a
// dance-aware BAR / BEAT layout of step cards. Beats group into bars per the
// dance (Waltz 3/4 → a 6-beat phrase of two bars), each step shows a derived
// duration, and a step's `direction` drives its "RF/LF <direction>" headline
// (foot is not stored — steps alternate feet).
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

describe("FigureTimeline — dance-aware bars & beats", () => {
  it("lays a Waltz figure out as one 6-beat phrase grouped into two bars of three", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" />);
    // 6 whole beats (a Waltz phrase), not a flat 8.
    expect(screen.getByRole("button", { name: /^beat 6$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^beat 7$/i })).toBeNull();
    // Grouped into 2 bars of beatsPerBar=3.
    expect(screen.getAllByLabelText(/^bar \d/i)).toHaveLength(2);
  });

  it("extends past the first phrase to cover an attribute placed later", async () => {
    const { FigureTimeline } = await load();
    // A footwork attribute on count 7 sits in the SECOND Waltz phrase, so the
    // ruler must extend to 12 beats (4 bars) to show it.
    renderUi(
      <FigureTimeline role="editor" dance="waltz" attributes={[attr("footwork", "ball", 7)]} />,
    );
    expect(screen.getByRole("button", { name: /^beat 7$/i })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^bar \d/i)).toHaveLength(4);
  });

  it("renders a step's direction as its headline", async () => {
    const { FigureTimeline } = await load();
    renderUi(
      <FigureTimeline role="editor" dance="waltz" attributes={[attr("direction", "forward", 1)]} />,
    );
    const headline = screen.getByTestId("step-headline-1");
    expect(headline).toHaveTextContent(/^forward$/i);
  });
});

describe("FigureTimeline — step-summary card + derived duration", () => {
  it("opening a step shows a summary with its headline and derived duration", async () => {
    const { FigureTimeline } = await load();
    // A step on count 1 with the next step on 1.5 → it lasts half a beat.
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        attributes={[attr("direction", "forward", 1), attr("footwork", "heel", 1.5)]}
      />,
    );
    await userEvent.click(screen.getByTestId("step-headline-1"));
    const summary = screen.getByTestId("step-summary");
    expect(summary).toHaveTextContent(/forward/i); // the direction headline
    expect(summary).toHaveTextContent(/½ beat/i); // derived from the gap to 1.5
  });
});

describe("FigureTimeline — placing & resizing steps", () => {
  it("opens the editor on an empty beat's Add step and places the attribute there", async () => {
    const { FigureTimeline } = await load();
    const onChange = vi.fn();
    renderUi(<FigureTimeline role="editor" dance="waltz" onChange={onChange} />);
    // Open beat 2 via its tick, then pick footwork — the attribute lands on 2.
    await userEvent.click(screen.getByRole("button", { name: /^beat 2$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^ball$/ }));
    const added = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find(
      (a) => a.kind === "footwork",
    );
    expect(added?.count).toBe(2);
  });

  it("resizes a step's duration with the keyboard (snaps later steps along)", async () => {
    const { FigureTimeline } = await load();
    const onChange = vi.fn();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        attributes={[attr("direction", "forward", 1), attr("footwork", "toe", 2)]}
        onChange={onChange}
      />,
    );
    // Grow step 1 (default ⅛ grid): the later step on 2 shifts by +⅛ to 2.125.
    const handle = screen.getByRole("slider", { name: /resize step 1/i });
    handle.focus();
    await userEvent.keyboard("{ArrowRight}");
    const moved = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find(
      (a) => a.kind === "footwork",
    );
    expect(moved?.count).toBe(2.125);
  });

  it("does not offer Add step affordances to a viewer", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="viewer" dance="waltz" />);
    expect(screen.queryByRole("button", { name: /add step/i })).toBeNull();
  });
});
