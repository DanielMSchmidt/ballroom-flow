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
  memberNames?: Record<string, string>;
  onOpenFigure?: (id: string) => void;
  onOpenThread?: (id: string) => void;
}

// The column picks persist per device (bb_read_columns) — clear between tests
// so one test's picks never leak into the next.
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

describe("RoutineReadingView — routine-wide picked columns (Builder v3)", () => {
  it("shows the default picks (Step · Rise · Turn) among the used kinds, with a merged Step chip", async () => {
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
    // Column headers: the picked columns (default Step/Rise/Turn/Pos ∩ used).
    // (Query by the info-overlay name: the picker chips row also renders the
    // bare labels, so text queries would double-match.)
    for (const head of ["Step", "Rise", "Turn"]) {
      expect(screen.getByRole("button", { name: `About ${head}` })).toBeInTheDocument();
    }
    expect(screen.queryByText("Sway")).toBeNull();
    expect(screen.queryByText("Pos")).toBeNull();
    // The Step column merges direction + footwork into one chip.
    expect(screen.getByText("fwd·H")).toBeInTheDocument();
    // Values render as tight column codes, not raw enum strings.
    expect(screen.getByText("Com")).toBeInTheDocument(); // rise: commence
    expect(screen.getByRole("button", { name: "About Turn — ¼R" })).toBeInTheDocument(); // turn: quarter_R
    expect(screen.queryByText("quarter_R")).toBeNull();
    // The hint row explains the picker + the notes margin.
    expect(screen.getByText(/pick up to 4 columns/i)).toBeInTheDocument();
  });

  it("falls back to the used kinds when none of the default picks are used (custom kind column)", async () => {
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

  it("shows the scope cue and an 'empty' timing sub for an un-notated figure", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(figure({ attributes: [] }));
    expect(screen.getByText(/library figure/i)).toBeInTheDocument(); // scope cue (global)
    // Builder v3: an empty figure reads "empty" in the header's timing sub.
    expect(screen.getByText(/^empty$/i)).toBeInTheDocument();
  });

  it("shows the figure's beat tokens as the header's timing sub (Builder v3)", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(
      figure({
        attributes: [
          attr(1, "direction", "forward"),
          attr(2, "direction", "side"),
          attr(3, "direction", "close"),
        ],
      }),
    );
    expect(screen.getByText("1 2 3")).toBeInTheDocument();
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
    // the on-beat (count 1) row does not.
    expect(container.querySelectorAll('ol [data-offbeat="true"]').length).toBe(1);
  });
});

describe("RoutineReadingView — notes margin (Builder v3)", () => {
  function renderWithAnnotations(extra: Partial<ReadingProps>) {
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
    return renderUi(
      <RoutineReadingView
        routine={routine}
        placements={[{ placement: { id: "p1", figureRef: fig.id }, figure: fig, status: "live" }]}
        roleView="leader"
        {...extra}
      />,
    );
  }

  it("labels the margin column NOTES and shows a step's latest note as a snippet", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderWithAnnotations({
      annotations: [
        {
          id: "an1",
          authorId: "u2",
          kind: "note",
          text: "heads stay left",
          tags: [],
          anchors: [{ type: "point", figureRef: "f1", count: 2 }],
          replies: [],
          createdAt: 1,
        },
      ],
    });
    expect(screen.getByText("NOTES")).toBeInTheDocument();
    expect(screen.getByText("heads stay left")).toBeInTheDocument();
  });

  it("opens the step's thread when its margin cell is tapped", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const onOpenThread = vi.fn();
    renderWithAnnotations({
      onOpenThread,
      annotations: [
        {
          id: "an1",
          authorId: "u2",
          kind: "note",
          text: "heads stay left",
          tags: [],
          anchors: [{ type: "point", figureRef: "f1", count: 2 }],
          replies: [],
          createdAt: 1,
        },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: /notes — count 1/i }));
    expect(onOpenThread).toHaveBeenCalledWith({ figureRef: "f1", count: 2 });
  });

  it("opens the WHOLE-FIGURE thread from the figure header's margin cell (no count)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const onOpenThread = vi.fn();
    renderWithAnnotations({
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
    });
    expect(screen.getByText("keep the frame quiet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /notes — natural turn/i }));
    expect(onOpenThread).toHaveBeenCalledWith({ figureRef: "f1" });
  });

  it("shows the ＋ add affordance only to a member who may comment", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const { unmount } = renderWithAnnotations({ canComment: true, onOpenThread: vi.fn() });
    // A commenter sees the ＋ chip inside the margin cells.
    expect(screen.getByRole("button", { name: /notes — count 1/i }).textContent).toContain("＋");
    unmount();
    renderWithAnnotations({ canComment: false, onOpenThread: vi.fn() });
    // A pure viewer's margin carries no add affordance.
    expect(screen.getByRole("button", { name: /notes — count 1/i }).textContent).not.toContain(
      "＋",
    );
  });

  it("uses the real member identity colour for the margin avatar (T9b)", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderWithAnnotations({
      memberColors: { u2: "#1f8a5b" }, // real stored identity hex
      memberNames: { u2: "Nadia" },
      annotations: [
        {
          id: "an1",
          authorId: "u2",
          kind: "note",
          text: "watch the rise",
          tags: [],
          anchors: [{ type: "point", figureRef: "f1", count: 2 }],
          replies: [],
          createdAt: 1,
        },
      ],
    });
    expect(screen.getByText("watch the rise")).toBeInTheDocument();
    const cell = screen.getByRole("button", { name: /notes — count 1/i });
    const avatar = cell.querySelector("span[data-avatar]") as HTMLElement | null;
    expect(avatar).not.toBeNull();
    expect(avatar?.textContent).toBe("N"); // initial rides inside the dot (#5)
    const bg = avatar?.style.background;
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

describe("RoutineReadingView — pick-up-to-4 column chips (Builder v3)", () => {
  // A figure using Step + Rise + Turn + Sway + Body, so the picker has spares.
  const fiveKinds = () =>
    figure({
      attributes: [
        attr(1, "direction", "forward"),
        attr(1, "rise", "commence"),
        attr(1, "turn", "quarter_R"),
        attr(1, "sway", "to_L"),
        attr(1, "bodyActions", ["CBM"]),
      ],
    });

  it("adds a column when an off chip is tapped, persisted per device", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(fiveKinds());
    // Default picks: Step + Rise + Turn (of the used kinds) — Sway is off.
    expect(screen.queryByRole("button", { name: "About Sway" })).toBeNull();
    const swayChip = screen.getByRole("button", { name: "Show the Sway column" });
    expect(swayChip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(swayChip);
    // Sway joins the table (4 columns now)…
    expect(screen.getByRole("button", { name: "About Sway" })).toBeInTheDocument();
    // …the chip flips on…
    expect(screen.getByRole("button", { name: "Hide the Sway column" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // …and the pick is remembered per device (bb_read_columns).
    expect(JSON.parse(localStorage.getItem("bb_read_columns") ?? "[]")).toContain("sway");
  });

  it("drops the oldest pick when a 5th column is chosen (max 4)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(fiveKinds());
    await userEvent.click(screen.getByRole("button", { name: "Show the Sway column" })); // 4th
    await userEvent.click(screen.getByRole("button", { name: "Show the Body column" })); // 5th → oldest (Step) drops
    expect(screen.getByRole("button", { name: "About Body" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "About Step" })).toBeNull();
    const stored = JSON.parse(localStorage.getItem("bb_read_columns") ?? "[]") as string[];
    expect(stored).toHaveLength(4);
    expect(stored).not.toContain("step");
  });

  it("removes a picked column on tap, but never the last one", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(fiveKinds());
    await userEvent.click(screen.getByRole("button", { name: "Hide the Rise column" }));
    expect(screen.queryByRole("button", { name: "About Rise" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Hide the Turn column" }));
    // Only Step remains — tapping it is a no-op (min 1 column).
    await userEvent.click(screen.getByRole("button", { name: "Hide the Step column" }));
    expect(screen.getByRole("button", { name: "About Step" })).toBeInTheDocument();
  });

  it("applies the picked columns routine-wide (a figure without the kind shows empty slots)", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const f1 = fiveKinds();
    const f2 = figure({ id: "f2", name: "Whisk", attributes: [attr(1, "direction", "forward")] });
    const routine: RoutineDoc = {
      id: "r1",
      title: "Gold Waltz",
      dance: "waltz",
      ownerId: "u1",
      sections: [
        {
          id: "s1",
          name: "1st Long Side",
          placements: [
            { id: "p1", figureRef: "f1" },
            { id: "p2", figureRef: "f2" },
          ],
        },
      ],
      annotations: [],
      schemaVersion: 1,
    };
    renderUi(
      <RoutineReadingView
        routine={routine}
        placements={[
          { placement: { id: "p1", figureRef: "f1" }, figure: f1, status: "live" },
          { placement: { id: "p2", figureRef: "f2" }, figure: f2, status: "live" },
        ]}
        roleView="leader"
      />,
    );
    // Both figures render the SAME picked headers (Rise appears twice).
    expect(screen.getAllByRole("button", { name: "About Rise" })).toHaveLength(2);
  });
});
