import { describe, expect, it } from "vitest";
import { deriveFigureCustomState } from "./custom";
import { addFigure, addSide, createRoutine, figureTimeline, routineFigures } from "./routine";

// Acceptance test for the flow the user described:
//   log in → create a choreo → add two sections → add three figures to each → open the
//   timeline and see the footwork, timing, and every attribute, in order, the moment the
//   figure is added.
//
// "Login" is the worker's job (Clerk); here the logged-in user is their id. The timeline
// view renders exactly what figureTimeline() returns, so asserting on it asserts what the
// user sees on screen.

describe("Assemble → Figure Timeline: figures arrive fully filled in, in order", () => {
  // 1. The user logs in and creates a choreography.
  const userId = "user_anna";
  const routine = createRoutine({
    id: "r1",
    title: "Comp Waltz",
    dance: "waltz",
    createdByUserId: userId,
  });

  // 2. Two sections.
  const longSide = addSide(routine, { id: "s1", kind: "long" });
  const corner = addSide(routine, { id: "s2", kind: "corner" });

  // 3. Three figures in each section, from the catalog.
  addFigure(routine, "s1", { id: "f1", libraryFigureId: "waltz.natural_turn" });
  addFigure(routine, "s1", { id: "f2", libraryFigureId: "waltz.reverse_turn" });
  addFigure(routine, "s1", { id: "f3", libraryFigureId: "waltz.closed_change" });
  addFigure(routine, "s2", { id: "f4", libraryFigureId: "waltz.whisk" });
  addFigure(routine, "s2", { id: "f5", libraryFigureId: "waltz.chasse_from_promenade_position" });
  addFigure(routine, "s2", { id: "f6", libraryFigureId: "waltz.outside_change" });

  it("the routine belongs to the signed-in user", () => {
    expect(routine.createdByUserId).toBe(userId);
  });

  it("has two sections, in the order they were added", () => {
    expect(routine.sides.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(routine.sides.map((s) => s.kind)).toEqual(["long", "corner"]);
  });

  it("each section holds its three figures in add order", () => {
    expect(longSide.figures.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(corner.figures.map((f) => f.id)).toEqual(["f4", "f5", "f6"]);
    expect(longSide.figures.map((f) => f.name)).toEqual([
      "Natural Turn",
      "Reverse Turn",
      "Closed Change (Natural to Reverse)",
    ]);
    expect(corner.figures.map((f) => f.name)).toEqual([
      "Whisk",
      "Chasse from Promenade Position",
      "Outside Change",
    ]);
  });

  it("the leader timeline of the Natural Turn shows every step's action, timing and footwork", () => {
    const natural = longSide.figures[0];
    if (!natural) throw new Error("missing figure");
    expect(figureTimeline(natural, "leader")).toEqual([
      { n: 1, action: "RF forward", timing: { beat: 1 }, foot: "HT" },
      { n: 2, action: "LF to side", timing: { beat: 2 }, foot: "T" },
      { n: 3, action: "RF closes to LF", timing: { beat: 3 }, foot: "TH" },
      { n: 4, action: "LF back", timing: { beat: 4 }, foot: "TH" },
      { n: 5, action: "RF to side", timing: { beat: 5 }, foot: "T" },
      { n: 6, action: "LF closes to RF", timing: { beat: 6 }, foot: "TH" },
    ]);
  });

  it("the follower timeline carries its own footwork (the heel turn differs from the leader)", () => {
    const natural = longSide.figures[0];
    if (!natural) throw new Error("missing figure");
    const follower = figureTimeline(natural, "follower");
    expect(follower.map((r) => r.foot)).toEqual(["TH", "HT", "TH", "HT", "T", "TH"]);
    expect(follower.map((r) => r.action)).toEqual([
      "LF back",
      "RF closes to LF (heel turn)",
      "LF to side and forward",
      "RF forward",
      "LF to side",
      "RF closes to LF",
    ]);
    // Every row knows its beat.
    expect(follower.map((r) => r.timing.beat)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("split-beat timing survives: the Chassé's third step lands on the '&'", () => {
    const chasse = corner.figures[1];
    if (!chasse) throw new Error("missing figure");
    const leader = figureTimeline(chasse, "leader");
    expect(leader).toEqual([
      { n: 1, action: "RF forward and across in PP and CBMP", timing: { beat: 1 }, foot: "HT" },
      { n: 2, action: "LF to side", timing: { beat: 2 }, foot: "T" },
      { n: 3, action: "RF closes to LF", timing: { beat: 2, sub: "&" }, foot: "T" },
      { n: 4, action: "LF to side and slightly forward", timing: { beat: 3 }, foot: "TH" },
    ]);
  });

  it("EVERY figure in the routine is pre-filled the moment it is added", () => {
    const figures = routineFigures(routine);
    expect(figures).toHaveLength(6);
    for (const fig of figures) {
      for (const role of ["leader", "follower"] as const) {
        const rows = figureTimeline(fig, role);
        expect(rows.length, `${fig.id} ${role}`).toBeGreaterThan(0);
        for (const row of rows) {
          // Footwork, an action, and a timing are present on every row — nothing is blank.
          expect(row.foot, `${fig.id} ${role} step ${row.n} footwork`).toBeTruthy();
          expect(row.action, `${fig.id} ${role} step ${row.n} action`).toBeTruthy();
          expect(typeof row.timing.beat, `${fig.id} ${role} step ${row.n} timing`).toBe("number");
        }
      }
    }
  });

  it("a just-added catalog figure is NOT marked custom (it matches its library default)", () => {
    for (const fig of routineFigures(routine)) {
      expect(deriveFigureCustomState(fig).isCustom, fig.id).toBe(false);
    }
  });
});
