import { describe, expect, it } from "vitest";
import { deriveFigureCustomState, isFigureCustom } from "./custom";
import { type FigureInstance, getLibraryFigure, instantiateFigure } from "./figures";

function naturalTurn(): FigureInstance {
  const lib = getLibraryFigure("waltz.natural_turn");
  if (!lib) throw new Error("fixture missing");
  return instantiateFigure(lib, "fig-1");
}

describe("deriveFigureCustomState — the owner's custom rule", () => {
  it("a freshly added library figure is PRISTINE (not custom)", () => {
    const result = deriveFigureCustomState(naturalTurn());
    expect(result.state).toBe("pristine");
    expect(result.isCustom).toBe(false);
    expect(result.isFork).toBe(false);
    expect(result.changes).toHaveLength(0);
    expect(result.additions).toHaveLength(0);
  });

  it("changing an already-configured attribute (footwork) → MODIFIED + custom, not a fork", () => {
    const fig = naturalTurn();
    const step = fig.leaderSteps[0];
    if (step) step.foot = "T"; // catalog default is "HT"

    const result = deriveFigureCustomState(fig);
    expect(result.state).toBe("modified");
    expect(result.isCustom).toBe(true);
    expect(result.isFork).toBe(false);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      role: "leader",
      stepIndex: 0,
      attribute: "foot",
      before: "HT",
      after: "T",
    });
  });

  it("adding a NEW attribute the default left blank (sway) → FORKED (implicit fork)", () => {
    const fig = naturalTurn();
    const step = fig.leaderSteps[0];
    if (step) step.sway = "to_R"; // default leaves sway unset

    const result = deriveFigureCustomState(fig);
    expect(result.state).toBe("forked");
    expect(result.isCustom).toBe(true);
    expect(result.isFork).toBe(true);
    expect(result.additions).toHaveLength(1);
    expect(result.additions[0]).toMatchObject({ stepIndex: 0, attribute: "sway", after: "to_R" });
  });

  it("adding a whole new step → FORKED", () => {
    const fig = naturalTurn();
    fig.leaderSteps.push({ action: "RF forward", foot: "HT", timing: { beat: 1 } });

    const result = deriveFigureCustomState(fig);
    expect(result.state).toBe("forked");
    expect(result.isFork).toBe(true);
    expect(result.additions.some((a) => a.attribute === "step")).toBe(true);
  });

  it("a change AND an addition together still read as FORKED (the stronger state)", () => {
    const fig = naturalTurn();
    const step = fig.leaderSteps[0];
    if (step) {
      step.foot = "T"; // change existing
      step.sway = "to_L"; // add new
    }

    const result = deriveFigureCustomState(fig);
    expect(result.state).toBe("forked");
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.additions.length).toBeGreaterThan(0);
  });

  it("editing then reverting the value returns to PRISTINE (state is derived, not sticky)", () => {
    const fig = naturalTurn();
    const step = fig.leaderSteps[0];
    if (step) step.foot = "T";
    expect(isFigureCustom(fig)).toBe(true);
    if (step) step.foot = "HT";
    expect(isFigureCustom(fig)).toBe(false);
  });

  it("removing a configured attribute counts as a modification, not a fork", () => {
    const fig = naturalTurn();
    const step = fig.leaderSteps[0];
    if (step) step.foot = null;

    const result = deriveFigureCustomState(fig);
    expect(result.state).toBe("modified");
    expect(result.isFork).toBe(false);
  });

  it("changing a figure-level configured field (name) → MODIFIED", () => {
    const fig = naturalTurn();
    fig.name = "My Natural Turn";
    expect(deriveFigureCustomState(fig).state).toBe("modified");
  });

  it("a figure composed from scratch (no library link) is always custom + a fork", () => {
    const fig: FigureInstance = {
      id: "fig-custom",
      libraryFigureId: null,
      name: "Invented Figure",
      leaderSteps: [{ action: "LF forward", foot: "HT", timing: { beat: 1 } }],
      followerSteps: [{ action: "RF back", foot: "TH", timing: { beat: 1 } }],
    };
    const result = deriveFigureCustomState(fig);
    expect(result.isCustom).toBe(true);
    expect(result.isFork).toBe(true);
  });

  it("multi-select body actions compare order-independently", () => {
    const fig = naturalTurn();
    const step = fig.leaderSteps[0];
    if (step) step.bodyActions = ["CBM"]; // default had none → addition
    expect(deriveFigureCustomState(fig).state).toBe("forked");
  });
});
