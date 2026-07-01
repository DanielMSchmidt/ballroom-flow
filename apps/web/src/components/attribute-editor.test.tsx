// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { Attribute } from "@ballroom/domain";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent, within } from "../test-support/render";

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

/** A footwork="ball" attribute on the given count (a value from the registry). */
const footworkBall = (count: number): Attribute => ({
  id: `footwork-${count}-ball`,
  kind: "footwork",
  count,
  value: "ball",
  role: null,
  deletedAt: null,
});

describe("US-028 Figure timeline: place/edit/remove attributes (hero flow)", () => {
  it("opens the single-attribute overlay on a cell and adds an attribute for that count", async () => {
    // Intent: tapping a cell opens the focused overlay; choosing a value adds it.
    // User scenario: an editor taps the Step cell at count 2 and picks footwork "HT".
    // Act: click the count-2 Step cell, then the "HT" footwork option.
    // Assert: onChange fires with a footwork="HT" attribute on count 2 (the add).
    // Covers US-028 AC-1 (tap a cell → add) — hero flow.
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    const onChange = vi.fn();
    renderUi(<FigureTimeline role="editor" dance="waltz" bars={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /^Add Step at count 2$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Heel-Toe$/ }));
    expect(onChange).toHaveBeenCalled();
    const added = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find(
      (a) => a.kind === "footwork" && a.count === 2,
    );
    expect(added?.value).toBe("HT");
  });

  it("clears a value when its selected option is re-tapped", async () => {
    // Intent: re-tapping a selected value clears it (toggle-off).
    // Arrange: render the editor with count 2 already = "ball".
    // Act: tap "ball" again. Assert: aria-pressed flips off + onChange emits an empty set.
    // Covers US-028 AC-2 (re-tap clears).
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    const onChange = vi.fn();
    renderUi(
      <AttributeEditor count={2} role="editor" value={[footworkBall(2)]} onChange={onChange} />,
    );
    const t = screen.getByRole("button", { name: /^ball$/, pressed: true });
    await userEvent.click(t);
    expect(onChange).toHaveBeenCalledWith([]); // the footwork="ball" was cleared
  });

  it("does not allow a commenter/viewer to edit", async () => {
    // Intent: edit affordances are gated by role (commenter/viewer read-only).
    // Arrange: render the editor (role=commenter) with an existing footwork="ball".
    // Act/Assert: "ball" shows but is NOT an interactive button (no toggle).
    // Covers US-028 AC-4 (commenter/viewer cannot edit).
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    renderUi(<AttributeEditor count={2} role="commenter" value={[footworkBall(2)]} />);
    expect(screen.queryByRole("button", { name: /^ball$/ })).toBeNull();
    expect(screen.getByText("ball")).toBeInTheDocument(); // shown read-only
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

/** A role-scoped attribute of `kind`=`value` on count `c`. */
const roleAttr = (kind: string, value: string, role: Attribute["role"], c = 1): Attribute => ({
  id: `${kind}-${c}-${value}-${role ?? "both"}`,
  kind,
  count: c,
  value,
  role,
  deletedAt: null,
});

describe("Attribute editor ROLES toggle (frame 1.12)", () => {
  it("offers a 'Same for both | Per role' roles toggle, defaulting to Same for both", async () => {
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" />);
    expect(screen.getByRole("radio", { name: /same for both/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /per role/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("in 'Same for both' a chosen value is written to both roles (role=null)", async () => {
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    const onChange = vi.fn();
    renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /^forward$/i }));
    const added = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find(
      (a) => a.kind === "direction",
    );
    expect(added?.role).toBeNull();
  });

  it("'Per role' splits into a Leader + Follower section; a follower pick is role-scoped", async () => {
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    const onChange = vi.fn();
    renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: /per role/i }));
    // Two rails appear.
    expect(screen.getByRole("group", { name: /leader/i })).toBeInTheDocument();
    const follower = screen.getByRole("group", { name: /follower/i });
    // Picking a direction inside the Follower rail writes role="follower".
    await userEvent.click(within(follower).getByRole("button", { name: /^back$/i }));
    const added = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find(
      (a) => a.kind === "direction",
    );
    expect(added?.role).toBe("follower");
  });

  it("defaults to 'Per role' when the count already has role-scoped values", async () => {
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    renderUi(
      <AttributeEditor
        count={1}
        dance="foxtrot"
        role="editor"
        value={[roleAttr("direction", "forward", "leader")]}
      />,
    );
    expect(screen.getByRole("radio", { name: /per role/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("'remove attribute' clears this count's values for the active role scope", async () => {
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    const onChange = vi.fn();
    renderUi(
      <AttributeEditor
        count={1}
        dance="foxtrot"
        role="editor"
        value={[roleAttr("direction", "forward", null), roleAttr("footwork", "ball", null)]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /remove attribute/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("hides the roles toggle + remove from a non-editor (read-only)", async () => {
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    renderUi(
      <AttributeEditor
        count={1}
        dance="foxtrot"
        role="commenter"
        value={[roleAttr("footwork", "ball", null)]}
      />,
    );
    expect(screen.queryByRole("radio", { name: /per role/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove attribute/i })).toBeNull();
    expect(screen.getByText("ball")).toBeInTheDocument(); // still shown read-only
  });
});

describe("US-029 Attribute editor (registry-derived sections)", () => {
  it("renders sections from the merged ATTRIBUTE_REGISTRY", async () => {
    // Intent: editor sections derive from the merged registry (one vocabulary).
    // The step IDENTITY (direction + footwork) leads; the technique kinds live
    // behind a "More attributes" disclosure (progressive disclosure parity).
    // Covers US-029 AC-1 (sections from registry) — §10.2.
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" />);
    // Identity kinds are always shown.
    for (const name of [/direction/i, /footwork/i]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    // Technique kinds appear once "More attributes" is expanded. Exact names so
    // "Position" doesn't also match the "Foot Position" heading.
    await userEvent.click(screen.getByRole("button", { name: /more attributes/i }));
    for (const name of ["Turn", "Sway", "Position", "Foot Position"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("hides the rise section for Tango (but shows it for a rise dance)", async () => {
    // Intent: Tango omits rise (appliesToDances) so the editor hides that section.
    // Rise is a technique kind, so reveal "More attributes" first.
    // Covers US-029 AC-2 (Tango hides rise) — §10.2 "Tango omits rise".
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    const { unmount } = renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" />);
    await userEvent.click(screen.getByRole("button", { name: /more attributes/i }));
    expect(screen.getByRole("heading", { name: /rise/i })).toBeInTheDocument(); // shown for foxtrot
    unmount();
    renderUi(<AttributeEditor count={1} dance="tango" role="editor" />);
    await userEvent.click(screen.getByRole("button", { name: /more attributes/i }));
    expect(screen.queryByRole("heading", { name: /rise/i })).toBeNull(); // hidden for tango
  });

  it("honors single (position) vs multi (custom kind) selection cardinality", async () => {
    // Intent: single-select replaces; multi-select accumulates (registry cardinality).
    // The only builtin multi kind (bodyActions) now closes to a single value
    // (CBM), so accumulation is demonstrated via a custom multi kind — the same
    // editor code path drives both.
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
    // position is a technique kind — reveal it first.
    await userEvent.click(screen.getByRole("button", { name: /more attributes/i }));
    await userEvent.click(screen.getByRole("button", { name: /^promenade$/i }));
    const afterSingle = onSingle.mock.calls.at(-1)?.[0] as Attribute[];
    expect(afterSingle.filter((a) => a.kind === "position")).toHaveLength(1);
    expect(afterSingle.find((a) => a.kind === "position")?.value).toBe("promenade");
    single.unmount();

    // MULTI (custom kind "hands"): start with "L"; picking "R" keeps BOTH.
    const handsKind = {
      kind: "hands",
      label: "Hands",
      color: "#123456",
      cardinality: "multi" as const,
      valueType: "enum",
      values: ["L", "R"],
      builtin: false,
    };
    const onMulti = vi.fn();
    renderUi(
      <AttributeEditor
        count={1}
        dance="foxtrot"
        role="editor"
        customKinds={[handsKind]}
        value={[attr("hands", "L")]}
        onChange={onMulti}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /more attributes/i }));
    await userEvent.click(screen.getByRole("button", { name: /^R$/ }));
    const afterMulti = onMulti.mock.calls.at(-1)?.[0] as Attribute[];
    expect(
      afterMulti
        .filter((a) => a.kind === "hands")
        .map((a) => a.value)
        .sort(),
    ).toEqual(["L", "R"]);
  });

  it("offers CBMP as a position value (CBMP is a position; CBP removed)", async () => {
    // Intent: "CBMP is a position; remove CBP." A figure that stored position
    //   "CBMP" shows the CBMP chip selected under Position; bodyActions no longer
    //   offers a CBMP option at all.
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    renderUi(
      <AttributeEditor
        count={1}
        dance="foxtrot"
        role="editor"
        value={[attr("position", "CBMP")]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /more attributes/i }));
    // The CBMP chip (now a position value) shows selected.
    expect(screen.getByRole("button", { name: /^CBMP$/ })).toHaveAttribute("aria-pressed", "true");
    // Body Actions offers CBM (labelled "Contra body" per the design), never CBMP.
    const bodyGroup = screen.getByRole("group", { name: /body actions/i });
    expect(within(bodyGroup).getByRole("button", { name: /^Contra body$/ })).toBeInTheDocument();
    expect(within(bodyGroup).queryByRole("button", { name: /^CBMP$/ })).toBeNull();
  });

  it("offers footwork as a closed picklist (no free-text custom input)", async () => {
    // Intent: footwork is now a CLOSED enum — the editor picks from the fixed set
    //   and does NOT render the free-text "Custom footwork…" add affordance.
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    const onChange = vi.fn();
    renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" onChange={onChange} />);
    // No free-text add for footwork.
    expect(screen.queryByPlaceholderText(/custom footwork/i)).toBeNull();
    // A footwork value is still pickable from the closed set.
    await userEvent.click(screen.getByRole("button", { name: "Heel-Toe" }));
    const added = (onChange.mock.calls.at(-1)?.[0] as Attribute[]).find(
      (a) => a.kind === "footwork",
    );
    expect(added?.value).toBe("HT");
  });

  it("labels values with full text in the editor and explains the selected value inline", async () => {
    // The edit picker reads as full descriptive labels ("Heel-Toe", not the "HT"
    // code the reading overview shows); selecting a value reveals its one-line
    // explanation (registry valueDefs) beneath the chips. The stored value is still
    // the canonical code.
    const { AttributeEditor } = await importComponent<AttributeEditorModule>(
      "../components/AttributeEditor",
    );
    renderUi(<AttributeEditor count={1} role="editor" value={[attr("footwork", "HT")]} />);
    expect(screen.getByRole("button", { name: "Heel-Toe" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "HT" })).toBeNull();
    // The selected value's explanation is shown in place.
    expect(screen.getByText(/Heel-Toe: heel then toe/i)).toBeInTheDocument();
  });
});

describe("US-030 Timeline role-view toggle", () => {
  /** A free-text footwork attribute on count 1 scoped to `role` (null = both).
   *  Values avoid underscores so they survive the editor-summary humanize pass. */
  const roleStep = (value: string, role: Attribute["role"]): Attribute => ({
    id: `footwork-1-${value}`,
    kind: "footwork",
    count: 1,
    value,
    role,
    deletedAt: null,
  });

  // A figure carrying one both-role + one leader-only + one follower-only value
  // on count 1, so the lens has something to show/hide in each view. The open
  // editor's "count 1 attributes" summary reflects the active lens.
  const roleSeeded: Attribute[] = [
    roleStep("bothside", null),
    roleStep("leadside", "leader"),
    roleStep("follside", "follower"),
  ];

  // The per-count recap is ALWAYS visible now (no "open the count" step) — the
  // grid renders it for every count that carries a value. Kept as a no-op so the
  // scenarios still read "then look at count 1's summary".
  const openCount1 = async () => {};
  const summary = () => screen.getByLabelText(/count 1 attributes/i);

  it("flips the viewed role on the 'Steps for' segmented lens (per-device preference)", async () => {
    // Intent: the role lens flips on the dedicated "Steps for" SegmentedToggle
    //   (frame 1.11); the choice is a per-device pref — local UI state only.
    // Covers US-030 AC-1 (flip; per-device pref).
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    renderUi(<FigureTimeline role="editor" initialView="leader" attributes={roleSeeded} />);
    await userEvent.click(screen.getByRole("radio", { name: /follower/i }));
    expect(screen.getByRole("radio", { name: /follower/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("always shows both-role (role=null) attributes regardless of the lens", async () => {
    // Intent: attributes with role=null show in EVERY view.
    // Covers US-030 AC-2 (both-role always shown).
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    renderUi(<FigureTimeline role="editor" initialView="leader" attributes={roleSeeded} />);
    await openCount1();
    expect(summary()).toHaveTextContent(/bothside/i);
    await userEvent.click(screen.getByRole("radio", { name: /follower/i }));
    expect(summary()).toHaveTextContent(/bothside/i);
  });

  it("shows role-specific attributes only for the selected role", async () => {
    // Intent: a leader-only attribute shows in the leader view and hides in follower.
    // Covers US-030 AC-3 (role-specific filtered by the selected role).
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    renderUi(<FigureTimeline role="editor" initialView="leader" attributes={roleSeeded} />);
    await openCount1();
    expect(summary()).toHaveTextContent(/leadside/i);
    expect(summary()).not.toHaveTextContent(/follside/i);
    await userEvent.click(screen.getByRole("radio", { name: /follower/i }));
    expect(summary()).not.toHaveTextContent(/leadside/i);
    expect(summary()).toHaveTextContent(/follside/i);
  });
});

describe("QUAL-5 role lens is controllable (unified with the reading view)", () => {
  // The reading view persists the Leader/Follower lens via the store (bb_role).
  // FigureTimeline + Lanes must accept that SAME role as a controlled prop so the
  // choice is consistent across reading + timeline + lanes (not ephemeral).
  const roleStep = (value: string, role: Attribute["role"]): Attribute => ({
    id: `footwork-1-${value}`,
    kind: "footwork",
    count: 1,
    value,
    role,
    deletedAt: null,
  });
  const seeded: Attribute[] = [
    roleStep("bothside", null),
    roleStep("leadside", "leader"),
    roleStep("follside", "follower"),
  ];

  it("FigureTimeline renders the controlled roleView and emits flips via onRoleViewChange", async () => {
    const { FigureTimeline } = await importComponent<TimelineModule>(
      "../components/FigureTimeline",
    );
    const onRoleViewChange = vi.fn();
    const { rerender } = renderUi(
      <FigureTimeline
        role="editor"
        dance="waltz"
        roleView="leader"
        onRoleViewChange={onRoleViewChange}
        attributes={seeded}
      />,
    );
    const summary = () => screen.getByLabelText(/count 1 attributes/i);
    // Controlled: leader view shows the leader-only value, hides follower-only.
    expect(summary()).toHaveTextContent(/leadside/i);
    expect(summary()).not.toHaveTextContent(/follside/i);
    // Flipping does NOT mutate internal state — it asks the owner to change.
    await userEvent.click(screen.getByRole("radio", { name: /follower/i }));
    expect(onRoleViewChange).toHaveBeenCalledWith("follower");
    // Still leader until the controlled prop changes (truly controlled).
    expect(summary()).toHaveTextContent(/leadside/i);
    // Owner pushes the new value back in → follower view now applies.
    rerender(
      <FigureTimeline
        role="editor"
        dance="waltz"
        roleView="follower"
        onRoleViewChange={onRoleViewChange}
        attributes={seeded}
      />,
    );
    expect(summary()).toHaveTextContent(/follside/i);
    expect(summary()).not.toHaveTextContent(/leadside/i);
  });

  it("Lanes renders the controlled roleView and emits flips via onRoleViewChange", async () => {
    const { Lanes } = await importComponent<LanesModule>("../components/Lanes");
    const onRoleViewChange = vi.fn();
    const follower: Attribute = {
      id: "sway-2-f",
      kind: "sway",
      count: 2,
      value: "to_R",
      role: "follower",
      deletedAt: null,
    };
    const { rerender } = renderUi(
      <Lanes
        kind="sway"
        role="editor"
        counts={3}
        dance="foxtrot"
        roleView="leader"
        onRoleViewChange={onRoleViewChange}
        attributes={[follower]}
      />,
    );
    expect(screen.queryByText("to_R")).toBeNull(); // hidden in the controlled leader view
    await userEvent.click(screen.getByRole("button", { name: /flip/i }));
    expect(onRoleViewChange).toHaveBeenCalledWith("follower");
    rerender(
      <Lanes
        kind="sway"
        role="editor"
        counts={3}
        dance="foxtrot"
        roleView="follower"
        onRoleViewChange={onRoleViewChange}
        attributes={[follower]}
      />,
    );
    expect(screen.getByText("to_R")).toBeInTheDocument();
  });
});

describe("US-044 Lanes (one kind across all counts)", () => {
  it("shows a single kind across every count and edits the same attributes as the timeline", async () => {
    // Intent: a lane lays out one kind across all counts; edits mirror the timeline.
    // Arrange: render <Lanes kind="sway"> for a figure with sway on counts 1 and 3.
    // Act: read the lane cells; edit count-2's sway.
    // Assert: a cell per count; editing updates the underlying attribute (onChange).
    // Covers US-044 AC-1 (one kind across counts) + AC-2 (same attributes).
    const { Lanes } = await importComponent<LanesModule>("../components/Lanes");
    const onChange = vi.fn();
    const sway = (c: number, v: string): Attribute => ({
      id: `sway-${c}`,
      kind: "sway",
      count: c,
      value: v,
      role: null,
      deletedAt: null,
    });
    renderUi(
      <Lanes
        kind="sway"
        role="editor"
        counts={3}
        dance="foxtrot"
        attributes={[sway(1, "to_L"), sway(3, "to_R")]}
        onChange={onChange}
      />,
    );
    expect(screen.getAllByRole("gridcell").length).toBe(3);
    await userEvent.click(screen.getByRole("button", { name: /count 2/i }));
    await userEvent.click(screen.getByRole("button", { name: /^to_R$/i }));
    expect(onChange).toHaveBeenCalled();
  });

  it("honors the role-view toggle in the lane", async () => {
    // Intent: lanes respect the same role-view preference as the timeline.
    // Arrange: render <Lanes> with a follower-only value; view=leader.
    // Act: flip to follower. Assert: the follower-only cell appears after the flip.
    // Covers US-044 AC-3 (lanes honor role toggle).
    const { Lanes } = await importComponent<LanesModule>("../components/Lanes");
    const follower: Attribute = {
      id: "sway-2-f",
      kind: "sway",
      count: 2,
      value: "to_R",
      role: "follower",
      deletedAt: null,
    };
    renderUi(
      <Lanes
        kind="sway"
        role="editor"
        counts={3}
        dance="foxtrot"
        initialView="leader"
        attributes={[follower]}
      />,
    );
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.queryByText("to_R")).toBeNull(); // hidden in leader view
    await userEvent.click(screen.getByRole("button", { name: /flip/i }));
    expect(screen.getByText("to_R")).toBeInTheDocument(); // shown in follower view
  });
});
