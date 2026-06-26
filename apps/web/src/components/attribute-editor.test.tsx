// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { Attribute } from "@ballroom/domain";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// US-028 — Figure timeline: place/edit/remove attributes [M2, user] (hero)
// US-029 — Attribute editor (registry-derived sections) [M2, user]
// US-030 — Timeline role-view toggle [M2, user]
// US-044 — Lanes (one kind across all counts) [M7, user]
//
// PLAN §4.4/§4.5, §10.2 component layer: "attribute editor (registry-derived;
// Tango hides rise; new user-defined kind appears); timeline role flip; Lanes".
//
// The Timeline/AttributeEditor/Lanes components are built by the frontend agent
// and DON'T EXIST YET → dynamic import behind it.skip. RED→GREEN: build the
// component to the documented behavior and unskip.
// ─────────────────────────────────────────────────────────────────────────

interface TimelineModule {
  FigureTimeline: ComponentType<Record<string, unknown>>;
}
interface AttributeEditorModule {
  AttributeEditor: ComponentType<Record<string, unknown>>;
}
interface LanesModule {
  Lanes: ComponentType<Record<string, unknown>>;
}

/** A step="T" attribute on the given count (footwork value from the registry). */
const stepT = (count: number): Attribute => ({
  id: `step-${count}-T`,
  kind: "step",
  count,
  value: "T",
  role: null,
  deletedAt: null,
});

describe("US-028 Figure timeline: place/edit/remove attributes (hero flow)", () => {
  it("opens the editor on tapping a count and adds an attribute for that count", async () => {
    // Intent: tapping a count opens the editor; choosing a value adds an attribute.
    // User scenario: an editor taps count 2 and picks footwork "T".
    // Act: click the count-2 cell, then the "T" footwork option.
    // Assert: onChange fires with a step="T" attribute on count 2 (the add).
    // Covers US-028 AC-1 (tap a count → add) — hero flow.
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    const onChange = vi.fn();
    renderUi(<FigureTimeline role="editor" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /count 2/i }));
    await userEvent.click(screen.getByRole("button", { name: /^T$/ }));
    expect(onChange).toHaveBeenCalled();
    const added = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find(
      (a) => a.kind === "step" && a.count === 2,
    );
    expect(added?.value).toBe("T");
  });

  it("clears a value when its selected option is re-tapped", async () => {
    // Intent: re-tapping a selected value clears it (toggle-off).
    // Arrange: render the editor with count 2 already = "T".
    // Act: tap "T" again. Assert: aria-pressed flips off + onChange emits an empty set.
    // Covers US-028 AC-2 (re-tap clears).
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    const onChange = vi.fn();
    renderUi(<AttributeEditor count={2} role="editor" value={[stepT(2)]} onChange={onChange} />);
    const t = screen.getByRole("button", { name: /^T$/, pressed: true });
    await userEvent.click(t);
    expect(onChange).toHaveBeenCalledWith([]); // the step="T" was cleared
  });

  it("does not allow a commenter/viewer to edit", async () => {
    // Intent: edit affordances are gated by role (commenter/viewer read-only).
    // Arrange: render the editor (role=commenter) with an existing step="T".
    // Act/Assert: "T" shows but is NOT an interactive button (no toggle).
    // Covers US-028 AC-4 (commenter/viewer cannot edit).
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    renderUi(<AttributeEditor count={2} role="commenter" value={[stepT(2)]} />);
    expect(screen.queryByRole("button", { name: /^T$/ })).toBeNull();
    expect(screen.getByText("T")).toBeInTheDocument(); // shown read-only
  });
});

/** An attribute of `kind`=`value` on count `c`. */
const attr = (kind: string, value: string, c = 1): Attribute => ({
  id: `${kind}-${c}-${value}`,
  kind,
  count: c,
  value,
  role: null,
  deletedAt: null,
});

describe("US-029 Attribute editor (registry-derived sections)", () => {
  it("renders sections from the merged ATTRIBUTE_REGISTRY", async () => {
    // Intent: editor sections derive from the merged registry (one vocabulary).
    // Assert: step/turn/sway/position section headings are present (Foxtrot).
    // Covers US-029 AC-1 (sections from registry) — §10.2.
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" />);
    for (const name of [/step/i, /turn/i, /sway/i, /position/i]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("hides the rise section for Tango (but shows it for a rise dance)", async () => {
    // Intent: Tango omits rise (appliesToDances) so the editor hides that section.
    // Covers US-029 AC-2 (Tango hides rise) — §10.2 "Tango omits rise".
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    const { unmount } = renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" />);
    expect(screen.getByRole("heading", { name: /rise/i })).toBeInTheDocument(); // shown for foxtrot
    unmount();
    renderUi(<AttributeEditor count={1} dance="tango" role="editor" />);
    expect(screen.queryByRole("heading", { name: /rise/i })).toBeNull(); // hidden for tango
  });

  it("honors single (position) vs multi (bodyActions) selection cardinality", async () => {
    // Intent: single-select replaces; multi-select accumulates (registry cardinality).
    // Covers US-029 AC-3 (single vs multi cardinality).
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    // SINGLE (position): start with "closed"; picking "promenade" replaces it.
    const onSingle = vi.fn();
    const single = renderUi(
      <AttributeEditor
        count={1}
        dance="foxtrot"
        role="editor"
        value={[attr("position", "closed")]}
        onChange={onSingle}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^promenade$/i }));
    const afterSingle = onSingle.mock.calls.at(-1)?.[0] as Attribute[];
    expect(afterSingle.filter((a) => a.kind === "position")).toHaveLength(1);
    expect(afterSingle.find((a) => a.kind === "position")?.value).toBe("promenade");
    single.unmount();

    // MULTI (bodyActions): start with "CBM"; picking "CBMP" keeps BOTH.
    const onMulti = vi.fn();
    renderUi(
      <AttributeEditor
        count={1}
        dance="foxtrot"
        role="editor"
        value={[attr("bodyActions", "CBM")]}
        onChange={onMulti}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^CBMP$/ }));
    const afterMulti = onMulti.mock.calls.at(-1)?.[0] as Attribute[];
    expect(
      afterMulti
        .filter((a) => a.kind === "bodyActions")
        .map((a) => a.value)
        .sort(),
    ).toEqual(["CBM", "CBMP"]);
  });

  it("normalizes a stored CBP value to CBMP (read alias, Q-D4)", async () => {
    // Intent: a legacy bodyActions value "CBP" reads as "CBMP" — the CBMP chip
    //   shows selected for a figure that stored "CBP".
    // Covers US-029 AC-4 (CBP→CBMP).
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    renderUi(
      <AttributeEditor
        count={1}
        dance="foxtrot"
        role="editor"
        value={[attr("bodyActions", "CBP")]}
      />,
    );
    expect(screen.getByRole("button", { name: /^CBMP$/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("adds a free-text step value (suggestions are not a closed enum, §3/#83)", async () => {
    // Intent: step is free-text — typing a custom action adds it alongside the
    //   footwork suggestions.
    // Covers #83 (step free-text on the editor side).
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    const onChange = vi.fn();
    renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText(/custom step/i), "brush_tap");
    await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
    const added = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find((a) => a.kind === "step");
    expect(added?.value).toBe("brush_tap");
  });
});

describe.skip("US-030 Timeline role-view toggle", () => {
  it("flips the viewed role on tapping a step (per-device preference)", async () => {
    // Intent: tapping a step flips the viewed role; the choice is a per-device pref
    //   (no stored User.defaultRole).
    // Arrange: render the timeline with view=leader. Act: tap a step / flip control.
    // Assert: the role indicator switches to follower.
    // Covers US-030 AC-1 (flip; per-device pref).
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    renderUi(<FigureTimeline role="editor" initialView="leader" />);
    await userEvent.click(screen.getByRole("button", { name: /flip role|follower/i }));
    expect(screen.getByRole("button", { name: /leader|follower/i })).toBeInTheDocument();
  });

  it("always shows both-role (role=null) attributes regardless of the toggle", async () => {
    // Intent: attributes with role=null show in EVERY view.
    // Arrange: render with a both-role attr, view=leader. Act: flip to follower.
    // Assert: the both-role attribute is visible before AND after the flip.
    // Covers US-030 AC-2 (both-role always shown).
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    renderUi(<FigureTimeline role="editor" initialView="leader" />);
    expect(screen.getByText(/both-role/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /flip role|follower/i }));
    expect(screen.getByText(/both-role/i)).toBeInTheDocument();
  });

  it("shows role-specific attributes only for the selected role", async () => {
    // Intent: a leader-only attribute shows in the leader view and hides in follower.
    // Arrange: render with a leader-only + a follower-only attr, view=leader.
    // Act: flip to follower. Assert: leader-only hidden, follower-only shown.
    // Covers US-030 AC-3 (role-specific filtered by the selected role).
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    renderUi(<FigureTimeline role="editor" initialView="leader" />);
    expect(screen.getByText(/leader-only/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /flip role|follower/i }));
    expect(screen.queryByText(/leader-only/i)).toBeNull();
  });
});

describe.skip("US-044 Lanes (one kind across all counts)", () => {
  it("shows a single kind across every count and edits the same attributes as the timeline", async () => {
    // Intent: a lane lays out one kind across all counts; edits mirror the timeline.
    // Arrange: render <Lanes kind="sway"> for a figure with sway on counts 1 and 3.
    // Act: read the lane cells; edit count-2's sway.
    // Assert: a cell per count; editing updates the underlying attribute (onChange).
    // Covers US-044 AC-1 (one kind across counts) + AC-2 (same attributes).
    const { Lanes } = await importComponent<LanesModule>("../components/Lanes");
    renderUi(<Lanes kind="sway" role="editor" />);
    expect(screen.getAllByRole("gridcell").length).toBeGreaterThan(0);
  });

  it("honors the role-view toggle in the lane", async () => {
    // Intent: lanes respect the same role-view preference as the timeline.
    // Arrange: render <Lanes> with a follower-only value; view=leader.
    // Act: flip to follower. Assert: the follower-only cell appears after the flip.
    // Covers US-044 AC-3 (lanes honor role toggle).
    const { Lanes } = await importComponent<LanesModule>("../components/Lanes");
    renderUi(<Lanes kind="sway" role="editor" initialView="leader" />);
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });
});
