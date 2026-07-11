// biome-ignore-all lint/a11y/useValidAriaRole: `role` is the per-document
// MEMBERSHIP role prop, not an ARIA role.
import type { Attribute } from "@weavesteps/domain";
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

  it("honors an explicit count length (Builder v3 ① — counts, not whole bars)", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" counts={4} />);
    // A 4-count figure ends mid-bar: count 4 exists, count 5 doesn't.
    expect(screen.getByRole("button", { name: /^Add Step at count 4$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add Step at count 5$/i })).toBeNull();
  });

  it("reads a legacy bars prop as bars × beatsPerBar", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" legacyBars={2} />);
    // Two Waltz bars = 6 beats; beat 7 is beyond the figure.
    expect(screen.getByRole("button", { name: /^Add Step at count 6$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add Step at count 7$/i })).toBeNull();
  });

  it("wraps visible count labels at the Waltz phrase — beat 7 of a 9-count figure reads '1'", async () => {
    // Intent: Waltz is counted 1–6; the grid never shows a "7". Bar 3 of a
    //   9-count figure reads 1/2/3 again. The cell ARIA identifiers keep the
    //   continuous count (unique names), only the visible labels wrap.
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" counts={9} />);
    // Beats 1 and 7 both read "1"; beats 3 and 9 both read "3"; no "7"/"8"/"9".
    expect(screen.getAllByText("1")).toHaveLength(2);
    expect(screen.getAllByText("3")).toHaveLength(2);
    expect(screen.queryByText("7")).toBeNull();
    expect(screen.queryByText("8")).toBeNull();
    // Sub-beats wrap with their beat: two "1&" rows (1.5 and 7.5).
    expect(screen.getAllByText("1&")).toHaveLength(2);
    // Bar grouping is untouched — bar 3 still exists.
    expect(screen.getByText(/^bar 3$/i)).toBeInTheDocument();
    // The unique per-cell identifiers stay continuous (beat 7 is addressable).
    expect(screen.getByRole("button", { name: /^Add Step at count 7$/i })).toBeInTheDocument();
  });

  it("titles the attribute overlay with the wrapped count (tapping beat 7 opens 'count 1')", async () => {
    // Intent: the single-attribute overlay's title must agree with the visible
    //   row label (design mock: the overlay carries the slot's wrapped count).
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" counts={9} />);
    await userEvent.click(screen.getByRole("button", { name: /^Add Rise at count 7$/i }));
    expect(screen.getByRole("heading", { name: /^count 1$/i })).toBeInTheDocument();
  });

  it("the LENGTH stepper emits the next count length (controlled by the parent)", async () => {
    const { FigureTimeline } = await load();
    const onCountsChange = vi.fn();
    renderUi(
      <FigureTimeline role="editor" dance="waltz" counts={6} onCountsChange={onCountsChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /increase length/i }));
    expect(onCountsChange).toHaveBeenCalledWith(7);
    await userEvent.click(screen.getByRole("button", { name: /decrease length/i }));
    expect(onCountsChange).toHaveBeenLastCalledWith(5);
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

describe("FigureTimeline — portion window (Builder v3 ③, §4.3/§4.4)", () => {
  const part = { fromCount: 4, toCount: 6 };

  it("windows the editor grid to the placed portion — only counts 4–6 are shown", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" counts={6} part={part} />);
    // The placed window is counts 4–6; the un-placed 1–3 must NOT be editable here
    // (the figure doc is still whole, but this placement dances only 4–6).
    expect(screen.getByRole("button", { name: /^Add Step at count 4$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add Step at count 6$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add Step at count 1$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Add Step at count 3$/i })).toBeNull();
  });

  it("keeps out-of-window content when editing inside the window (merge-back, no tombstoning)", async () => {
    const { FigureTimeline } = await load();
    const onChange = vi.fn();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        counts={6}
        part={part}
        attributes={[
          attr("direction", "forward", 1), // outside the window — must survive the edit
          { id: "d5", kind: "direction", count: 5, value: null, role: null, deletedAt: null },
        ]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Edit Step at count 5$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Heel-Toe$/ }));
    const next = onChange.mock.calls.at(-1)?.[0] as Attribute[];
    // The edit at count 5 lands…
    expect(next.find((a) => a.kind === "footwork" && a.count === 5)).toBeTruthy();
    // …and the count-1 content OUTSIDE the window is preserved untouched (not cleared),
    // so the variant owns only the edited beat and 1–3 keep resolving live from the base.
    expect(next.find((a) => a.kind === "direction" && a.count === 1)).toBeTruthy();
  });

  it("hides the LENGTH stepper for a portioned placement (the window is fixed)", async () => {
    const { FigureTimeline } = await load();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        counts={6}
        part={part}
        onCountsChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /increase length/i })).toBeNull();
  });

  it("labels the editor with the placed portion (4–6 of 6)", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" counts={6} part={part} />);
    expect(screen.getByText(/4–6 of 6/)).toBeInTheDocument();
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
  it("opens the single-attribute overlay on a PRESENT Step cell and places the value at that count", async () => {
    const { FigureTimeline } = await load();
    const onChange = vi.fn();
    // A blank step already placed at count 2 (Builder v3 ② quick-add put it there);
    // tapping the present cell opens the focused overlay → pick footwork "Heel-Toe".
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        counts={3}
        attributes={[
          { id: "d2", kind: "direction", count: 2, value: null, role: null, deletedAt: null },
        ]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Edit Step at count 2$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Heel-Toe$/ }));
    const added = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find(
      (a) => a.kind === "footwork",
    );
    expect(added?.count).toBe(2);
  });

  it("places a value on a sub-beat cell (¼ off-beat) at that fractional count", async () => {
    const { FigureTimeline } = await load();
    const onChange = vi.fn();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        counts={3}
        attributes={[
          { id: "d2e", kind: "direction", count: 2.25, value: null, role: null, deletedAt: null },
        ]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Edit Step at count 2e$/i }));
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
    expect(screen.queryByRole("button", { name: /increase length/i })).toBeNull();
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

describe("FigureTimeline — 'add to my library' affordance (⟳v5, PLAN §4.2/§5.2)", () => {
  it("shows 'Add to my library' for an owned (account) figure and calls onAddToLibrary", async () => {
    const { FigureTimeline } = await load();
    const onAddToLibrary = vi.fn();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        figureScope="owned"
        onAddToLibrary={onAddToLibrary}
      />,
    );
    const button = screen.getByRole("button", { name: /add to my library/i });
    // Builder v3 ⑤: the button opens the naming bar; Save bookmarks.
    await userEvent.click(button);
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onAddToLibrary).toHaveBeenCalledTimes(1);
  });

  it("shows 'In your library' (no button) once bookmarked", async () => {
    const { FigureTimeline } = await load();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        figureScope="owned"
        isBookmarked
        onAddToLibrary={vi.fn()}
      />,
    );
    expect(screen.getByText(/in your library/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add to my library/i })).toBeNull();
  });

  it("hides the affordance for a GLOBAL (catalog) figure — that bookmark lives on the Library screen", async () => {
    const { FigureTimeline } = await load();
    renderUi(
      <FigureTimeline role="editor" dance="waltz" figureScope="global" onAddToLibrary={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /add to my library/i })).toBeNull();
    expect(screen.queryByText(/in your library/i)).toBeNull();
  });

  it("hides the affordance when the caller doesn't wire onAddToLibrary", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" figureScope="owned" />);
    expect(screen.queryByRole("button", { name: /add to my library/i })).toBeNull();
  });
});

describe("FigureTimeline — Builder v3 edit-grid parity", () => {
  it("marks the Step column like every other (nothing is required — no asterisk)", async () => {
    const { FigureTimeline } = await load();
    renderUi(<FigureTimeline role="editor" dance="waltz" />);
    const step = screen.getByRole("button", { name: /about step/i });
    expect(step.textContent).not.toContain("*");
  });

  it("renders a dashed 'present' marker for an attribute whose value is empty", async () => {
    const { FigureTimeline } = await load();
    const { container } = renderUi(
      <FigureTimeline role="editor" dance="waltz" attributes={[attr("rise", "", 1)]} />,
    );
    // The cell is neither a value chip nor the faint ＋ — the attribute exists
    // but has no value yet (Builder v3 three-state cell).
    expect(container.querySelector("[data-present-cell]")).not.toBeNull();
    // It still opens the single-attribute editor for that (count, kind).
    expect(screen.getByRole("button", { name: /^Edit Rise at count 1$/i })).toBeInTheDocument();
  });

  it("shows the 'adjusted — still {name}' chip beside Add to library for a diverged figure", async () => {
    // `adjusted` is the design's variantBar.adjusted flag: the figure HAS an
    // origin (a base / catalog identity) it was adjusted away from.
    const { FigureTimeline } = await load();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        figureScope="owned"
        figureName="Natural Turn"
        adjusted
        onAddToLibrary={vi.fn()}
      />,
    );
    expect(screen.getByText(/adjusted for this choreo — still Natural Turn/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add to my library/i })).toBeInTheDocument();
  });

  it("hides the 'adjusted — still {name}' chip for a from-scratch custom (nothing was adjusted)", async () => {
    // A custom figure created in this choreo has no base/origin — the identity
    // reassurance makes no sense; the Add-to-library affordance still shows.
    const { FigureTimeline } = await load();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        figureScope="owned"
        figureName="Right Lunge"
        onAddToLibrary={vi.fn()}
      />,
    );
    expect(screen.queryByText(/adjusted for this choreo/i)).toBeNull();
    expect(screen.getByRole("button", { name: /add to my library/i })).toBeInTheDocument();
  });
});

describe("FigureTimeline — presence quick-add (Builder v3 ②)", () => {
  it("tapping an empty Step cell places a blank step (presence direction attr) without opening the editor", async () => {
    const { FigureTimeline } = await load();
    const onChange = vi.fn();
    renderUi(<FigureTimeline role="editor" dance="waltz" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /^Add Step at count 1$/i }));
    // The blank step lands instantly as a value-less direction attribute…
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as Array<{ kind: string; value: unknown }>;
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ kind: "direction", value: null, count: 1 });
    // …no editor sheet opens…
    expect(screen.queryByRole("dialog")).toBeNull();
    // …and the toast confirms the placement.
    expect(screen.getByText(/step placed/i)).toBeInTheDocument();
  });

  it("tapping an empty closed-enum cell (Rise) still opens the single-attribute editor", async () => {
    const { FigureTimeline } = await load();
    const onChange = vi.fn();
    renderUi(<FigureTimeline role="editor" dance="waltz" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /^Add Rise at count 1$/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("tapping a PRESENT (value-less) cell opens the editor to set its value", async () => {
    const { FigureTimeline } = await load();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        attributes={[
          { id: "a1", kind: "direction", count: 1, value: null, role: null, deletedAt: null },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Edit Step at count 1$/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("FigureTimeline — add-to-library naming flow (Builder v3 ⑤)", () => {
  it("names the variant, renames the live figure, then bookmarks", async () => {
    const { FigureTimeline } = await load();
    const onAddToLibrary = vi.fn();
    const onRenameFigure = vi.fn();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        figureScope="owned"
        figureName="Natural Turn"
        onAddToLibrary={onAddToLibrary}
        onRenameFigure={onRenameFigure}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add to my library/i }));
    const input = screen.getByRole("textbox", { name: /variant name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Overturned Natural");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onRenameFigure).toHaveBeenCalledWith("Overturned Natural");
    expect(onAddToLibrary).toHaveBeenCalledTimes(1);
  });

  it("keeping the same name skips the rename but still bookmarks", async () => {
    const { FigureTimeline } = await load();
    const onAddToLibrary = vi.fn();
    const onRenameFigure = vi.fn();
    renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        figureScope="owned"
        figureName="Natural Turn"
        onAddToLibrary={onAddToLibrary}
        onRenameFigure={onRenameFigure}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add to my library/i }));
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onRenameFigure).not.toHaveBeenCalled();
    expect(onAddToLibrary).toHaveBeenCalledTimes(1);
  });
});
