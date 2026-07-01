import type { Annotation, Attribute, FigureDoc, RoutineDoc } from "@ballroom/domain";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedPlacement } from "../store/routine";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen } from "../test-support/render";
import type { RoleView } from "./role-view";

interface ReadingProps {
  routine: RoutineDoc;
  placements: ResolvedPlacement[];
  roleView: RoleView;
  onRoleViewChange: (v: RoleView) => void;
  annotations?: Annotation[];
  canComment?: boolean;
  memberColors?: Record<string, string>;
  onOpenFigure?: (id: string) => void;
  onOpenThread?: (id: string) => void;
}
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
    <RoutineReadingView
      routine={routine}
      placements={placements}
      roleView={roleView}
      onRoleViewChange={vi.fn()}
    />,
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
    for (const head of ["Step", "Rise", "Turn"]) {
      expect(screen.getByText(head)).toBeInTheDocument();
    }
    expect(screen.queryByText("Sway")).toBeNull();
    expect(screen.queryByText("Pos")).toBeNull();
    // The Step column merges direction + footwork into one chip.
    expect(screen.getByText("fwd·H")).toBeInTheDocument();
    // Values render as tight column codes, not raw enum strings.
    expect(screen.getByText("Com")).toBeInTheDocument(); // rise: commence
    expect(screen.getByText("¼R")).toBeInTheDocument(); // turn: quarter_R
    expect(screen.queryByText("quarter_R")).toBeNull();
  });

  it("gives a custom kind its own titled column", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(figure({ attributes: [attr(1, "bodyActions", ["CBM"])] }));
    expect(screen.getByText("Body")).toBeInTheDocument(); // titled column
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
        onRoleViewChange={vi.fn()}
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

  it("shows '+ add comment' with ZERO comments when the user can comment", async () => {
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
        onRoleViewChange={vi.fn()}
        annotations={[]} // ZERO comments
        canComment
        onOpenThread={onOpenThread}
      />,
    );
    const add = screen.getByRole("button", { name: /add comment/i });
    expect(add).toBeInTheDocument();
    await userEvent.click(add);
    expect(onOpenThread).toHaveBeenCalledWith({ figureRef: "f1", count: 1 });
  });

  it("hides '+ add comment' for a viewer (cannot comment)", async () => {
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
        onRoleViewChange={vi.fn()}
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
    expect(screen.queryByRole("button", { name: /add comment/i })).toBeNull();
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
        onRoleViewChange={vi.fn()}
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
