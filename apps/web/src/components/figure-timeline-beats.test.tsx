// biome-ignore-all lint/a11y/useValidAriaRole: `role` is the per-document
// MEMBERSHIP role prop, not an ARIA role.
import type { Attribute } from "@ballroom/domain";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// Notation parity (2026-06-28): the figure timeline is a dance-aware BEAT RULER,
// not a flat 1–8 strip. Beats group into bars per the dance (Waltz: 3/4, a
// 6-beat phrase → two bars of 1·2·3), and a step's `direction` is its headline.
// The musical model already exists in @ballroom/domain (timing.ts/dances.ts);
// this surfaces it in the editor.
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

describe("FigureTimeline — dance-aware beat ruler", () => {
  it("lays a Waltz figure out as one 6-beat phrase grouped into two bars of three", async () => {
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    renderUi(<FigureTimeline role="editor" dance="waltz" />);
    // 6 whole beats (a Waltz phrase), not the old flat 8.
    expect(screen.getByRole("button", { name: /count 6/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /count 7/i })).toBeNull();
    // Grouped into 2 bars of beatsPerBar=3.
    expect(screen.getAllByLabelText(/^bar \d/i)).toHaveLength(2);
  });

  it("extends past the first phrase to cover an attribute placed later", async () => {
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    // A footwork attribute on count 7 sits in the SECOND Waltz phrase, so the
    // ruler must extend to 12 beats (4 bars) to show it.
    renderUi(
      <FigureTimeline role="editor" dance="waltz" attributes={[attr("footwork", "ball", 7)]} />,
    );
    expect(screen.getByRole("button", { name: /count 7/i })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^bar \d/i)).toHaveLength(4);
  });

  it("renders a step's direction as its headline", async () => {
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    renderUi(
      <FigureTimeline role="editor" dance="waltz" attributes={[attr("direction", "forward", 1)]} />,
    );
    const headline = screen.getByTestId("step-headline-1");
    expect(headline).toHaveTextContent(/forward/i);
  });
});
