// biome-ignore-all lint/a11y/useValidAriaRole: `role` is the per-document
// MEMBERSHIP role prop, not an ARIA role.
import type { Attribute } from "@ballroom/domain";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// 2026-07-01 design update (frames 1.11/1.12): the figure timeline is a
// BARS-DRIVEN column grid. Its rows come from the figure's authored bar count —
// for each bar → each beat (1..beatsPerBar) → the whole beat then its e/&/a
// sub-beats — NOT from the steps it already has, so every place a value could go
// is shown. A "− N bars +" stepper sets the length. Tapping ANY cell opens a
// focused SINGLE-ATTRIBUTE overlay for exactly that (timing, attribute); a value
// picked there lands on that count. The dance scopes the beat grouping (Waltz 3/4
// → 3 beats per bar) and the applicable kind columns (Tango omits Rise).
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

describe("FigureTimeline — bars-driven beat-row grid", () => {
  it("defaults an empty Waltz figure to one bar (3 beats)", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" />);
    // One bar of Waltz = 3 beats; there is no beat 4 until the length grows.
    expect(screen.getByRole("button", { name: /^Add Step at count 3$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add Step at count 4$/i })).toBeNull();
  });

  it("honors an explicit bar count from the `bars` prop", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" bars={2} />);
    // Two Waltz bars = 6 beats; beat 7 is beyond the figure.
    expect(screen.getByRole("button", { name: /^Add Step at count 6$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add Step at count 7$/i })).toBeNull();
  });

  it("the bars stepper emits the next length (controlled by the parent)", async () => {
    const { FigureTimeline } = await load();
    const onBarsChange = vi.fn();
    renderUi(<FigureTimeline role="editor" dance="waltz" bars={2} onBarsChange={onBarsChange} />);
    await userEvent.click(screen.getByRole("button", { name: /increase bars/i }));
    expect(onBarsChange).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole("button", { name: /decrease bars/i }));
    expect(onBarsChange).toHaveBeenLastCalledWith(1);
  });

  it("renders every whole beat plus its e/&/a sub-beat rows", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" bars={1} />);
    // Beat 1's in-between slots are present as cells (no separate "add" affordance).
    expect(screen.getByRole("button", { name: /^Add Step at count 1e$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add Step at count 1&$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add Step at count 1a$/i })).toBeInTheDocument();
  });

  it("shows the dance's applicable kind columns (Tango omits Rise)", async () => {
    const { FigureTimeline } = await load();
    const waltz = renderUi(<FigureTimeline role="editor" dance="waltz" />);
    expect(screen.getByRole("columnheader", { name: /rise/i })).toBeInTheDocument();
    waltz.unmount();
    renderUi(<FigureTimeline role="editor" dance="tango" />);
    expect(screen.queryByRole("columnheader", { name: /rise/i })).toBeNull();
  });

  it("still shows an attribute placed OUTSIDE the current bar range (no value hidden)", async () => {
    const { FigureTimeline } = await load();
    // A footwork attribute on count 7 sits beyond a 1-bar figure; its row is still
    // rendered so the value is never hidden, and its recap reads it.
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        bars={1}
        attributes={[attr("footwork", "ball", 7)]}
      />,
    );
    expect(screen.getByLabelText(/count 7 attributes/i)).toHaveTextContent(/ball/i);
  });
});

describe("FigureTimeline — the per-count recap (always visible)", () => {
  it("shows each count's direction headline + value chips without opening anything", async () => {
    const { FigureTimeline } = await load();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        attributes={[attr("direction", "forward", 1), attr("footwork", "ball", 1)]}
      />,
    );
    expect(screen.getByTestId("step-headline-1")).toHaveTextContent(/^forward$/i);
    expect(screen.getByLabelText(/count 1 attributes/i)).toHaveTextContent(/ball/i);
  });
});

describe("FigureTimeline — placing a step via a cell overlay", () => {
  it("opens the single-attribute overlay on a cell and places the value at that count", async () => {
    const { FigureTimeline } = await load();
    const onChange = vi.fn();
    renderUi(<FigureTimeline role="editor" dance="waltz" bars={1} onChange={onChange} />);
    // Tap the Step cell at count 2 → the focused overlay → pick footwork "Heel-Toe".
    await userEvent.click(screen.getByRole("button", { name: /^Add Step at count 2$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Heel-Toe$/ }));
    const added = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find(
      (a) => a.kind === "footwork",
    );
    expect(added?.count).toBe(2);
  });

  it("places a value on a sub-beat cell (¼ off-beat) at that fractional count", async () => {
    const { FigureTimeline } = await load();
    const onChange = vi.fn();
    renderUi(<FigureTimeline role="editor" dance="waltz" bars={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /^Add Step at count 2e$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Heel-Toe$/ }));
    const added = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find(
      (a) => a.kind === "footwork",
    );
    expect(added?.count).toBe(2.25);
  });

  it("does not offer add affordances to a viewer (read grid only)", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="viewer" dance="waltz" />);
    // A viewer sees values but gets no add-cell buttons and no bars stepper.
    expect(screen.queryByRole("button", { name: /Add .* at count/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /increase bars/i })).toBeNull();
  });
});

describe("FigureTimeline — the single-attribute overlay (frame 1.12)", () => {
  it("titles a whole-beat overlay 'count N' with the attribute name beneath", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" bars={1} />);
    await userEvent.click(screen.getByRole("button", { name: /^Add Rise at count 2$/i }));
    expect(screen.getByRole("heading", { name: /^count 2$/i })).toBeInTheDocument();
  });

  it("titles a sub-beat overlay by its symbol and fraction — 'the & (½ beat)'", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" bars={1} />);
    await userEvent.click(screen.getByRole("button", { name: /^Add Rise at count 2&$/i }));
    expect(screen.getByRole("heading", { name: /the & \(½ beat\)/i })).toBeInTheDocument();
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
