import type { Annotation, Attribute, FigureDoc, RoutineDoc } from "@weavesteps/domain";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedPlacement } from "../store/routine";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen } from "../test-support/render";
import type { RoleView } from "./role-view";

interface ReadingProps {
  routine: RoutineDoc;
  placements: ResolvedPlacement[];
  roleView: RoleView;
  annotations?: Annotation[];
  canComment?: boolean;
  memberColors?: Record<string, string>;
  onOpenFigure?: (id: string) => void;
  onOpenThread?: (id: string) => void;
}

// The column filter + its one-time hint persist per device (bb_hidden_types /
// bb_hidden_types_hint) — clear between tests so filters never leak across.
beforeEach(() => {
  localStorage.clear();
});
interface ReadingModule {
  RoutineReadingView: ComponentType<ReadingProps>;
}

const attr = (
  count: number,
  kind: string,
  value: unknown,
  role: Attribute["role"] = null,
): Attribute => ({
  id: `${kind}-${count}-${String(value)}`,
  kind,
  count,
  value,
  role,
  deletedAt: null,
});

const figure = (over: Partial<FigureDoc>): FigureDoc => ({
  id: "f1",
  scope: "global",
  ownerId: "u1",
  figureType: "natural-turn",
  dance: "waltz",
  name: "Natural Turn",
  source: "library",
  attributes: [],
  schemaVersion: 1,
  ...over,
});

let RoutineReadingView: ReadingModule["RoutineReadingView"];

function renderReading(fig: FigureDoc, roleView: RoleView = "leader") {
  const routine: RoutineDoc = {
    id: "r1",
    title: "Gold Waltz",
    dance: "waltz",
    ownerId: "u1",
    sections: [{ id: "s1", name: "1st Long Side", placements: [{ id: "p1", figureRef: fig.id }] }],
    annotations: [],
    schemaVersion: 1,
  };
  const placements: ResolvedPlacement[] = [
    { placement: { id: "p1", figureRef: fig.id }, figure: fig, status: "live" },
  ];
  return renderUi(
    <RoutineReadingView routine={routine} placements={placements} roleView={roleView} />,
  );
}

describe("RoutineReadingView — per-figure used-columns table (frame 1.6)", () => {
  it("renders ONLY the kinds a figure uses, with a merged Step chip", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(
      figure({
        attributes: [
          attr(1, "direction", "forward"),
          attr(1, "rise", "commence"),
          attr(1, "footwork", "heel"),
          attr(1, "turn", "quarter_R"),
        ],
      }),
    );
    expect(screen.getByTestId("reading-view")).toBeInTheDocument();
    expect(screen.getByText("1st Long Side")).toBeInTheDocument();
    // Column headers: only what's set — Step, Rise, Turn (no Sway/Pos column).
    // (Query by the info-overlay name: the filter chips row also renders the
    // bare labels, so text queries would double-match.)
    for (const head of ["Step", "Rise", "Turn"]) {
      expect(screen.getByRole("button", { name: `About ${head}` })).toBeInTheDocument();
    }
    expect(screen.queryByText("Sway")).toBeNull();
    expect(screen.queryByText("Pos")).toBeNull();
    // The Step column merges direction + footwork into one chip.
    expect(screen.getByText("fwd·H")).toBeInTheDocument();
    // Values render as tight column codes, not raw enum strings. The turn chip
    // splits the fraction glyph and the direction letter into two nodes (a
    // deliberate 2px gap — AttrChip), so match on the chip's text CONTENT.
    expect(screen.getByText("Com")).toBeInTheDocument(); // rise: commence
    expect(screen.getByRole("button", { name: "About Turn — ¼R" })).toBeInTheDocument(); // turn: quarter_R
    expect(screen.queryByText("quarter_R")).toBeNull();
  });

  it("gives a custom kind its own titled column", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(figure({ attributes: [attr(1, "bodyActions", ["CBM"])] }));
    expect(screen.getByRole("button", { name: "About Body" })).toBeInTheDocument(); // titled column
    expect(screen.getByText("CBM")).toBeInTheDocument(); // CBM → "CBM"
  });

  it("flips role-aware values with the Leader/Follower lens", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(
      figure({
        attributes: [
          attr(1, "direction", "forward", "leader"),
          attr(1, "direction", "back", "follower"),
        ],
      }),
      "follower",
    );
    // The follower lens shows the follower's step, not the leader's.
    expect(screen.getByText("back")).toBeInTheDocument();
    expect(screen.queryByText("fwd")).toBeNull();
  });

  it("shows the scope cue and a placeholder for an un-notated figure", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(figure({ attributes: [] }));
    expect(screen.getByText(/no steps noted yet/i)).toBeInTheDocument();
    expect(screen.getByText(/library figure/i)).toBeInTheDocument(); // scope cue (global)
  });

  it("dims off-beat (sub-beat) rows", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const { container } = renderReading(
      figure({
        attributes: [attr(1, "direction", "forward"), attr(1.5, "direction", "side")],
      }),
    );
    // The off-beat (count 1.5 → "1&") step row carries the data-offbeat marker;
    // the on-beat (count 1) row does not. (Scope to the step list — the count
    // pill independently dims its own off-beat tokens.)
    expect(container.querySelectorAll('ol [data-offbeat="true"]').length).toBe(1);
  });

  it("renders an inline comment under its step and opens the thread on tap", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const fig = figure({ attributes: [attr(2, "direction", "side")] });
    const routine: RoutineDoc = {
      id: "r1",
      title: "Gold Waltz",
      dance: "waltz",
      ownerId: "u1",
      sections: [
        { id: "s1", name: "1st Long Side", placements: [{ id: "p1", figureRef: fig.id }] },
      ],
      annotations: [],
      schemaVersion: 1,
    };
    const onOpenThread = vi.fn();
    renderUi(
      <RoutineReadingView
        routine={routine}
        placements={[{ placement: { id: "p1", figureRef: fig.id }, figure: fig, status: "live" }]}
        roleView="leader"
        annotations={[
          {
            id: "an1",
            authorId: "u2",
            kind: "note",
            text: "heads stay left",
            tags: [],
            anchors: [{ type: "point", figureRef: fig.id, count: 2 }],
            replies: [],
            createdAt: 1,
          },
        ]}
        onOpenThread={onOpenThread}
      />,
    );
    await userEvent.click(screen.getByText("heads stay left"));
    expect(onOpenThread).toHaveBeenCalledWith({ figureRef: "f1", count: 2 });
  });

  it("shows '✎ Add note' with ZERO comments when the user can comment", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const fig = figure({ attributes: [attr(1, "direction", "forward")] });
    const routine: RoutineDoc = {
      id: "r1",
      title: "Gold Waltz",
      dance: "waltz",
      ownerId: "u1",
      sections: [
        { id: "s1", name: "1st Long Side", placements: [{ id: "p1", figureRef: fig.id }] },
      ],
      annotations: [],
      schemaVersion: 1,
    };
    const onOpenThread = vi.fn();
    renderUi(
      <RoutineReadingView
        routine={routine}
        placements={[{ placement: { id: "p1", figureRef: fig.id }, figure: fig, status: "live" }]}
        roleView="leader"
        annotations={[]} // ZERO comments
        canComment
        onOpenThread={onOpenThread}
      />,
    );
    const add = screen.getByRole("button", { name: "Add note" });
    expect(add).toBeInTheDocument();
    await userEvent.click(add);
    expect(onOpenThread).toHaveBeenCalledWith({ figureRef: "f1", count: 1 });
  });

  it("hides '✎ Add note' for a viewer (cannot comment)", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const fig = figure({ attributes: [attr(1, "direction", "forward")] });
    const routine: RoutineDoc = {
      id: "r1",
      title: "Gold Waltz",
      dance: "waltz",
      ownerId: "u1",
      sections: [
        { id: "s1", name: "1st Long Side", placements: [{ id: "p1", figureRef: fig.id }] },
      ],
      annotations: [],
      schemaVersion: 1,
    };
    renderUi(
      <RoutineReadingView
        routine={routine}
        placements={[{ placement: { id: "p1", figureRef: fig.id }, figure: fig, status: "live" }]}
        roleView="leader"
        annotations={[
          {
            id: "an1",
            authorId: "u2",
            kind: "note",
            text: "keep posture",
            tags: [],
            anchors: [{ type: "point", figureRef: fig.id, count: 1 }],
            replies: [],
            createdAt: 1,
          },
        ]}
        canComment={false} // a pure viewer
        onOpenThread={vi.fn()}
      />,
    );
    // A viewer still READS the comment…
    expect(screen.getByText("keep posture")).toBeInTheDocument();
    // …but never sees the add affordance.
    expect(screen.queryByRole("button", { name: /add note/i })).toBeNull();
  });

  it("uses the real member identity colour for inline comment dots (T9b)", async () => {
    // TDD: prove the dot uses the member's stored hex, not the hash fallback.
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const fig = figure({ attributes: [attr(2, "direction", "side")] });
    const routine: RoutineDoc = {
      id: "r1",
      title: "Gold Waltz",
      dance: "waltz",
      ownerId: "u1",
      sections: [
        { id: "s1", name: "1st Long Side", placements: [{ id: "p1", figureRef: fig.id }] },
      ],
      annotations: [],
      schemaVersion: 1,
    };
    renderUi(
      <RoutineReadingView
        routine={routine}
        placements={[{ placement: { id: "p1", figureRef: fig.id }, figure: fig, status: "live" }]}
        roleView="leader"
        memberColors={{ u2: "#1f8a5b" }} // real stored identity hex
        annotations={[
          {
            id: "an1",
            authorId: "u2",
            kind: "note",
            text: "watch the rise",
            tags: [],
            anchors: [{ type: "point", figureRef: fig.id, count: 2 }],
            replies: [],
            createdAt: 1,
          },
        ]}
      />,
    );
    // The comment text must render.
    expect(screen.getByText("watch the rise")).toBeInTheDocument();
    // The dot beside the comment must use the real stored hex, not a CSS var from the hash.
    // jsdom may normalise hex → rgb(); accept either form so the assertion stays stable.
    const commentBtn = screen.getByText("watch the rise").closest("button");
    const dot = commentBtn?.querySelector("span[aria-hidden='true']") as HTMLElement | null;
    expect(dot).not.toBeNull();
    const bg = dot?.style.background;
    // #1f8a5b === rgb(31, 138, 91) — accept both representations.
    expect(bg === "#1f8a5b" || bg === "rgb(31, 138, 91)").toBe(true);
  });
});

describe("RoutineReadingView — continuous beat numbering + breaks (US-004a)", () => {
  const threeStep = (id: string, name: string): FigureDoc =>
    figure({
      id,
      name,
      attributes: [
        attr(1, "direction", "forward"),
        attr(2, "direction", "side"),
        attr(3, "direction", "close"),
      ],
    });

  function renderRoutine(
    sections: RoutineDoc["sections"],
    placements: ResolvedPlacement[],
    extra: Partial<ReadingProps> = {},
  ) {
    const routine: RoutineDoc = {
      id: "r1",
      title: "Gold Waltz",
      dance: "waltz",
      ownerId: "u1",
      sections,
      annotations: [],
      schemaVersion: 1,
    };
    return renderUi(
      <RoutineReadingView routine={routine} placements={placements} roleView="leader" {...extra} />,
    );
  }

  it("continues the beat count across figures (second figure reads 4 5 6)", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const f1 = threeStep("f1", "Natural Turn");
    const f2 = threeStep("f2", "Reverse Turn");
    renderRoutine(
      [
        {
          id: "s1",
          name: "1st Long Side",
          placements: [
            { id: "p1", figureRef: "f1" },
            { id: "p2", figureRef: "f2" },
          ],
        },
      ],
      [
        { placement: { id: "p1", figureRef: "f1" }, figure: f1, status: "live" },
        { placement: { id: "p2", figureRef: "f2" }, figure: f2, status: "live" },
      ],
    );
    // The SECOND figure's step rows continue the counter: 4, 5, 6.
    const second = screen.getByRole("list", { name: /reverse turn steps/i });
    expect(second).toHaveTextContent(/4/);
    expect(second).toHaveTextContent(/5/);
    expect(second).toHaveTextContent(/6/);
  });

  it("renders a break as a muted row with its phrase span + bar count", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const f1 = threeStep("f1", "Natural Turn");
    renderRoutine(
      [
        {
          id: "s1",
          name: "1st Long Side",
          placements: [
            { id: "p1", figureRef: "f1" },
            { id: "p2", source: "break", beats: 3 },
          ],
        },
      ],
      [{ placement: { id: "p1", figureRef: "f1" }, figure: f1, status: "live" }],
    );
    const brk = screen.getByTestId("break-readout");
    // The figure took beats 1–3, so the break occupies beats 4–6 (one Waltz bar).
    expect(brk).toHaveTextContent(/beats 4–6/);
    expect(brk).toHaveTextContent(/1 bar/);
  });

  it("shows a WHOLE FIGURE note block and opens the figure thread (no count)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const f1 = threeStep("f1", "Natural Turn");
    const onOpenThread = vi.fn();
    renderRoutine(
      [{ id: "s1", name: "1st Long Side", placements: [{ id: "p1", figureRef: "f1" }] }],
      [{ placement: { id: "p1", figureRef: "f1" }, figure: f1, status: "live" }],
      {
        canComment: true,
        onOpenThread,
        annotations: [
          {
            id: "an1",
            authorId: "u2",
            kind: "note",
            text: "keep the frame quiet",
            tags: [],
            anchors: [{ type: "figure", figureRef: "f1" }],
            replies: [],
            createdAt: 1,
          },
        ],
      },
    );
    const block = screen.getByTestId("whole-figure-notes");
    expect(block).toHaveTextContent(/whole figure/i);
    expect(block).toHaveTextContent(/keep the frame quiet/i);
    // Tapping the note opens the FIGURE thread — a figure anchor, no count.
    await userEvent.click(screen.getByText("keep the frame quiet"));
    expect(onOpenThread).toHaveBeenCalledWith({ figureRef: "f1" });
  });
});

describe("RoutineReadingView — attribute info overlay (frame 1.13)", () => {
  it("opens the info overlay when a column header is tapped", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(
      figure({
        attributes: [attr(1, "rise", "commence"), attr(3, "rise", "up")],
      }),
    );
    // No overlay until the user asks for it.
    expect(screen.queryByRole("heading", { name: /rise & fall/i })).toBeNull();
    // The header button is exactly "About Rise" (the chip button carries the value too).
    await userEvent.click(screen.getByRole("button", { name: /^about rise$/i }));
    // The sheet titles the kind (its full registry label) + a usage footer.
    expect(screen.getByRole("heading", { name: /rise & fall/i })).toBeInTheDocument();
    expect(screen.getByText(/used in 2 steps across gold waltz/i)).toBeInTheDocument();
  });

  it("opens the info overlay when a value chip is tapped", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(figure({ attributes: [attr(1, "turn", "quarter_R")] }));
    // The chip shows the SHORT code in the view…
    const chip = screen.getByRole("button", { name: /about turn — ¼R/i });
    await userEvent.click(chip);
    // …and the overlay shows the LONGER reference for the kind.
    expect(screen.getByRole("heading", { name: /^turn$/i })).toBeInTheDocument();
  });

  it("describes BOTH direction and footwork for the merged Step column", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(
      figure({ attributes: [attr(1, "direction", "forward"), attr(1, "footwork", "heel")] }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^about step$/i }));
    // The combined Step slot names each kind as its own section.
    expect(screen.getByRole("heading", { name: /^step$/i })).toBeInTheDocument(); // sheet title
    expect(screen.getByRole("heading", { name: /^direction$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^footwork$/i })).toBeInTheDocument();
  });

  it("still shows a value list for a custom kind with no registry prose", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    // A kind present on the figure but absent from the merged registry (no
    // customKinds passed) — the overlay synthesizes its values from the figure.
    renderReading(figure({ attributes: [attr(1, "energy", "high")] }));
    await userEvent.click(screen.getByRole("button", { name: /^about energy$/i }));
    expect(screen.getByRole("heading", { name: /^energy$/i })).toBeInTheDocument();
    // The observed value renders as a chip even with no definition text.
    const values = screen.getAllByText("high");
    expect(values.length).toBeGreaterThan(0);
  });
});

describe("RoutineReadingView — type-chip column filter (design 1.23)", () => {
  // A figure using Step + Rise + Turn, so the chips row shows all three.
  const threeKinds = () =>
    figure({
      attributes: [
        attr(1, "direction", "forward"),
        attr(1, "rise", "commence"),
        attr(1, "turn", "quarter_R"),
      ],
    });

  it("hides that column across the routine when a chip is tapped, persisted per device", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(threeKinds());
    // Everything on by default (the row only ever reduces).
    expect(screen.getByRole("button", { name: "About Rise" })).toBeInTheDocument();
    const riseChip = screen.getByRole("button", { name: "Hide the Rise column" });
    expect(riseChip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(riseChip);
    // The Rise column is gone from the figure's table (header + value)…
    expect(screen.queryByRole("button", { name: "About Rise" })).toBeNull();
    expect(screen.queryByText("Com")).toBeNull();
    // …the chip flips to its dashed OFF state…
    expect(screen.getByRole("button", { name: "Show the Rise column" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // …and the choice is remembered per device, across choreos (bb_hidden_types).
    expect(JSON.parse(localStorage.getItem("bb_hidden_types") ?? "[]")).toContain("rise");
    // Hiding never touches data: the other columns still render their values.
    expect(screen.getByText("fwd")).toBeInTheDocument();
  });

  it("keeps Step locked — tapping it only surfaces the always-shown toast", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(threeKinds());
    await userEvent.click(screen.getByRole("button", { name: "Step column — always shown" }));
    expect(screen.getByText("Step is always shown")).toBeInTheDocument();
    // The Step column survives, and nothing was persisted.
    expect(screen.getByRole("button", { name: "About Step" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("bb_hidden_types") ?? "[]")).toHaveLength(0);
  });

  it("peeks a figure's hidden columns via '+N hidden' and collapses again", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    localStorage.setItem("bb_hidden_types", JSON.stringify(["rise", "turn"]));
    localStorage.setItem("bb_hidden_types_hint", "done"); // hint already seen
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(threeKinds());
    // Both hidden columns are tucked; the figure carries a "+2 hidden" pill.
    expect(screen.queryByRole("button", { name: "About Rise" })).toBeNull();
    const pill = screen.getByRole("button", { name: "Peek at 2 hidden columns" });
    await userEvent.click(pill);
    // Peek: THIS figure expands to everything; the chips stay put (still off).
    expect(screen.getByRole("button", { name: "About Rise" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About Turn" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show the Rise column" })).toBeInTheDocument();
    // The pill flips to "– hide"; tapping again collapses the peek.
    await userEvent.click(
      screen.getByRole("button", { name: "Hide the tucked-away columns again" }),
    );
    expect(screen.queryByRole("button", { name: "About Rise" })).toBeNull();
  });

  it("shows the one-time 'tucked away' hint the first time a view hides data", async () => {
    localStorage.setItem("bb_hidden_types", JSON.stringify(["rise"]));
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(threeKinds());
    // The backup for tour skippers (design 1.26): a one-time toast points at
    // the "+N hidden" affordance…
    expect(screen.getByText(/some columns are tucked away/i)).toBeInTheDocument();
    // …and never re-nags (the flag is stamped at show).
    expect(localStorage.getItem("bb_hidden_types_hint")).toBe("done");
  });
});
