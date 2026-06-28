import type { Attribute, FigureDoc, RoutineDoc } from "@ballroom/domain";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import type { ResolvedPlacement } from "../store/routine";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen } from "../test-support/render";

interface ReadingModule {
  RoutineReadingView: ComponentType<{ routine: RoutineDoc; placements: ResolvedPlacement[] }>;
}

const attr = (count: number, kind: string, value: unknown): Attribute => ({
  id: `${kind}-${count}-${value}`,
  kind,
  count,
  value,
  role: null,
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

function renderReading(fig: FigureDoc) {
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
  return renderReadingView(routine, placements);
}

let RoutineReadingView: ReadingModule["RoutineReadingView"];
function renderReadingView(routine: RoutineDoc, placements: ResolvedPlacement[]) {
  return renderUi(<RoutineReadingView routine={routine} placements={placements} />);
}

describe("RoutineReadingView — columnar reading table (.pen parity)", () => {
  it("lays each figure out as count + headline + technique columns", async () => {
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
    // The five technique column headers.
    for (const code of ["Ri", "Bo", "Fw", "Sw", "Tn"]) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
    // Step headline is the direction (no foot — that was a design mistake).
    expect(screen.getByText("forward")).toBeInTheDocument();
    // Values render as tight column codes, not raw enum strings.
    expect(screen.getByText("com")).toBeInTheDocument(); // rise: commence
    expect(screen.getByText("¼R")).toBeInTheDocument(); // turn: quarter_R
    expect(screen.getByText("H")).toBeInTheDocument(); // footwork: heel
    expect(screen.queryByText("quarter_R")).toBeNull();
  });

  it("routes body actions into the Body column", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(figure({ attributes: [attr(1, "bodyActions", ["CBM"])] }));
    expect(screen.getByText("CB")).toBeInTheDocument(); // CBM → "CB" in the Body column
  });

  it("shows the figure scope badge and a placeholder for an un-notated figure", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(figure({ attributes: [] }));
    expect(screen.getByText(/no steps noted yet/i)).toBeInTheDocument();
    expect(screen.getByText(/library/i)).toBeInTheDocument(); // scope badge (global)
  });
});
