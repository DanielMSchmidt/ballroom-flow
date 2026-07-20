import type { Annotation, Attribute, FigureDoc, RoutineDoc } from "@weavesteps/domain";
import { type ComponentType, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FamilyNote } from "../store/family-notes";
import type { PredicateNote } from "../store/predicate-notes";
import type { ResolvedPlacement } from "../store/routine";
import { importComponent } from "../test-support/import-component";
import { axeCheck, renderUi, screen } from "../test-support/render";
import type { RoleView } from "./role-view";

interface ReadingProps {
  routine: RoutineDoc;
  placements: ResolvedPlacement[];
  roleView: RoleView;
  annotations?: Annotation[];
  familyNotes?: FamilyNote[];
  predicateNotes?: PredicateNote[];
  canComment?: boolean;
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
  onOpenFigure?: (id: string) => void;
  onOpenThread?: (id: string) => void;
  collapsedSections?: ReadonlySet<string>;
  onToggleSection?: (sectionId: string) => void;
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

  it("marks a notated-but-valueless step with a present dot, not a blank slot", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    // A step placed with no value yet is a PRESENCE attribute (value null —
    // Builder v3 ②). It must still read as "a step is here": the reading view
    // shows a kind-colored present dot in the Step column, NOT an empty slot.
    // count 1 has a valueless step; count 2 has a real Rise value (so the table
    // carries both a Step and a Rise column, and empty slots to contrast).
    const { container } = renderReading(
      figure({ attributes: [attr(1, "direction", null), attr(2, "rise", "commence")] }),
    );
    // The step rows render (the figure isn't "empty").
    expect(screen.queryByText(/^empty$/i)).toBeNull();
    const steps = screen.getByRole("list", { name: /natural turn steps/i });
    // A present marker exists for the notated step…
    const present = steps.querySelectorAll("[data-present-cell]");
    expect(present.length).toBeGreaterThan(0);
    // …tinted to the Step (direction) kind, not the grey empty-slot border.
    const dot = present[0];
    if (!(dot instanceof HTMLElement)) throw new Error("expected an HTMLElement marker");
    expect(dot.style.background).toContain("bf-kind-direction");
    // …and it's distinct from a truly empty slot (still rendered elsewhere).
    expect(container.querySelectorAll('ol [style*="bf-border-strong"]').length).toBeGreaterThan(0);
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
    await userEvent.click(screen.getByRole("button", { name: /notes — count 2/i }));
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
    expect(screen.getByRole("button", { name: /notes — count 2/i }).textContent).toContain("＋");
    unmount();
    renderWithAnnotations({ canComment: false, onOpenThread: vi.fn() });
    // A pure viewer's margin carries no add affordance.
    expect(screen.getByRole("button", { name: /notes — count 2/i }).textContent).not.toContain(
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
    const cell = screen.getByRole("button", { name: /notes — count 2/i });
    const avatar = cell.querySelector("span[data-avatar]");
    expect(avatar).not.toBeNull();
    expect(avatar?.textContent).toBe("N"); // initial rides inside the dot (#5)
    const bg = avatar instanceof HTMLElement ? avatar.style.background : undefined;
    // #1f8a5b === rgb(31, 138, 91) — accept both representations.
    expect(bg === "#1f8a5b" || bg === "rgb(31, 138, 91)").toBe(true);
  });
});

describe("RoutineReadingView — family notes fold into the margin (US-040/041)", () => {
  // A three-count Feather so a timed note can pin to count 3 and an untimed one
  // lands on the header. figureType "feather" + dance "waltz" so family notes
  // match by identity (the reading routine is a Waltz).
  const feather = (): FigureDoc =>
    figure({
      id: "f1",
      figureType: "feather",
      name: "Feather",
      counts: 3,
      attributes: [
        attr(1, "direction", "forward"),
        attr(2, "direction", "side"),
        attr(3, "direction", "close"),
      ],
    });

  function renderWithFamily(extra: Partial<ReadingProps>) {
    const fig = feather();
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

  const familyNote = (over: Partial<FamilyNote>): FamilyNote => {
    const figureType = over.figureType ?? "feather";
    const danceScope = over.danceScope ?? "waltz";
    const count = over.count;
    return {
      id: "fn1",
      authorId: "coauthor",
      kind: "lesson",
      text: "sway grows through the rise",
      figureType,
      danceScope,
      anchors: [
        {
          type: "figureType",
          figureType,
          danceScope: danceScope === "all" ? "all" : "waltz",
          ...(count != null ? { count } : {}),
        },
      ],
      ...(count != null ? { count } : {}),
      ...over,
    };
  };

  it("renders a whole-figure (untimed) family note on the figure-header margin cell", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderWithFamily({
      familyNotes: [familyNote({ id: "fn-whole", text: "keep the poise long", createdAt: 5 })],
    });
    // The header cell (…— Feather) carries the family note's snippet.
    const header = screen.getByRole("button", { name: /notes — feather/i });
    expect(header).toHaveTextContent("keep the poise long");
  });

  it("pins a TIMED family note (WEP-0004) to its count row, not the header", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderWithFamily({
      familyNotes: [
        familyNote({ id: "fn-timed", text: "rise begins here", count: 3, createdAt: 5 }),
      ],
    });
    // The count-3 row cell shows the timed note…
    const row3 = screen.getByRole("button", { name: /notes — count 3/i });
    expect(row3).toHaveTextContent("rise begins here");
    // …and the header cell does NOT (it's pinned, not whole-figure).
    const header = screen.getByRole("button", { name: /notes — feather/i });
    expect(header).not.toHaveTextContent("rise begins here");
  });

  it("soft-falls-back a timed note onto the header when the figure is too short to cover the count", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    // A 3-count Feather can't cover a note pinned to count 5 → shows un-pinned on
    // the header rather than vanishing (figureTypeNoteCount's soft fallback).
    renderWithFamily({
      familyNotes: [familyNote({ id: "fn-far", text: "only in the long variant", count: 5 })],
    });
    const header = screen.getByRole("button", { name: /notes — feather/i });
    expect(header).toHaveTextContent("only in the long variant");
  });

  it("renders a co-member's family note with the author's avatar colour + initial", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    // authorId ≠ the viewer — the margin avatar uses the co-author's stored colour.
    renderWithFamily({
      memberColors: { coauthor: "#1f8a5b" },
      memberNames: { coauthor: "Priya" },
      familyNotes: [familyNote({ id: "fn-co", text: "heads left on 2", createdAt: 5 })],
    });
    const header = screen.getByRole("button", { name: /notes — feather/i });
    expect(header).toHaveTextContent("heads left on 2");
    const avatar = header.querySelector("span[data-avatar]");
    expect(avatar?.textContent).toBe("P");
    const bg = avatar instanceof HTMLElement ? avatar.style.background : undefined;
    expect(bg === "#1f8a5b" || bg === "rgb(31, 138, 91)").toBe(true);
  });

  it("folds a family note and a routine annotation into ONE cell, newest-first snippet", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderWithFamily({
      // Routine whole-figure comment at t=1 (older).
      annotations: [
        {
          id: "an-old",
          authorId: "u2",
          kind: "note",
          text: "older routine note",
          tags: [],
          anchors: [{ type: "figure", figureRef: "f1" }],
          replies: [],
          createdAt: 1,
        },
      ],
      // Family note at t=10 (newer) → it wins the latest-snippet slot.
      familyNotes: [familyNote({ id: "fn-new", text: "newer family note", createdAt: 10 })],
    });
    const header = screen.getByRole("button", { name: /notes — feather/i });
    // BOTH authors contribute avatars (u2 + coauthor) — two dots in the cluster.
    expect(header.querySelectorAll("span[data-avatar]")).toHaveLength(2);
    // The NEWER note is the visible snippet; the older one collapses under it.
    expect(header).toHaveTextContent("newer family note");
    expect(header).not.toHaveTextContent("older routine note");
  });

  it("marks a family-scope note with a screen-reader cue so it doesn't read as a live comment", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderWithFamily({
      familyNotes: [familyNote({ id: "fn-sr", text: "family-scope note", createdAt: 5 })],
    });
    const header = screen.getByRole("button", { name: /notes — feather/i });
    // The margin's own vocabulary (sr-only text) distinguishes the scope — no new visual.
    expect(header).toHaveTextContent(/family note/i);
  });

  it("does not surface a family note whose family/dance doesn't match this figure", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderWithFamily({
      familyNotes: [familyNote({ id: "fn-miss", figureType: "three-step", text: "wrong family" })],
    });
    const header = screen.getByRole("button", { name: /notes — feather/i });
    expect(header).not.toHaveTextContent("wrong family");
  });

  it("is axe-clean with family notes folded into the margin", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const { container } = renderWithFamily({
      canComment: true,
      onOpenThread: vi.fn(),
      familyNotes: [
        familyNote({ id: "fn-a", text: "whole-figure family note", createdAt: 5 }),
        familyNote({ id: "fn-b", text: "timed family note", count: 3, createdAt: 6 }),
      ],
    });
    expect(await axeCheck(container)).toHaveNoViolations();
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

  // ── Length-driven progression (2026-07-14 fix): a placement advances the
  // counter by its figure's authored length (a portion: its window span), never
  // by how many steps it carries — a held beat still occupies its time. ──

  it("starts the next figure after the previous figure's LENGTH (a held beat still counts)", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    // f1 is 3 beats long but steps only on 1 and 3 (beat 2 is a hold) — the
    // steps read their real beats "1 3", and f2 still starts on 4.
    const f1 = figure({
      id: "f1",
      name: "Hesitation",
      counts: 3,
      attributes: [attr(1, "direction", "forward"), attr(3, "direction", "close")],
    });
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
    // Header timing subs carry the joined beat tokens.
    expect(screen.getByText("1 3")).toBeInTheDocument();
    expect(screen.getByText("4 5 6")).toBeInTheDocument();
  });

  it("a step-less Break FIGURE advances the counter by its counts (PLAN §2.3)", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const brk = figure({ id: "fb", name: "Break", counts: 3, attributes: [] });
    const f2 = threeStep("f2", "Natural Turn");
    renderRoutine(
      [
        {
          id: "s1",
          name: "1st Long Side",
          placements: [
            { id: "p1", figureRef: "fb" },
            { id: "p2", figureRef: "f2" },
          ],
        },
      ],
      [
        { placement: { id: "p1", figureRef: "fb" }, figure: brk, status: "live" },
        { placement: { id: "p2", figureRef: "f2" }, figure: f2, status: "live" },
      ],
    );
    // The Break occupies beats 1–3 even with no steps; the figure reads 4 5 6.
    expect(screen.getByText("4 5 6")).toBeInTheDocument();
  });

  it("advances a portioned placement by its WINDOW span, numbered from the block start", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const f1 = threeStep("f1", "Natural Turn"); // beats 1–3
    // p2 dances counts 4–6 of a 6-count figure, stepping only on 4 and 6 (5 is
    // a hold): the window spans beats 4–6, its steps read "4 6", and the next
    // placement starts on 1 (wrapping the Waltz phrase after 6 beats).
    const f2 = figure({
      id: "f2",
      name: "Reverse Turn",
      counts: 6,
      attributes: [attr(4, "direction", "back"), attr(6, "direction", "close")],
    });
    const f3 = threeStep("f3", "Whisk");
    renderRoutine(
      [
        {
          id: "s1",
          name: "1st Long Side",
          placements: [
            { id: "p1", figureRef: "f1" },
            { id: "p2", figureRef: "f2", part: { fromCount: 4, toCount: 6 } },
            { id: "p3", figureRef: "f3" },
          ],
        },
      ],
      [
        { placement: { id: "p1", figureRef: "f1" }, figure: f1, status: "live" },
        {
          placement: { id: "p2", figureRef: "f2", part: { fromCount: 4, toCount: 6 } },
          figure: f2,
          status: "live",
        },
        { placement: { id: "p3", figureRef: "f3" }, figure: f3, status: "live" },
      ],
    );
    // The windowed steps read their block beats (4 and 6, the hold on 5 unnumbered)…
    const second = screen.getByRole("list", { name: /reverse turn steps/i });
    expect(second).toHaveTextContent(/4/);
    expect(second).toHaveTextContent(/6/);
    // …and the figure AFTER the window starts a fresh phrase — both f1 and f3
    // read "1 2 3" (f3 wrapped after 3 + 3 window beats fill the Waltz phrase).
    expect(screen.getAllByText("1 2 3")).toHaveLength(2);
  });
});

describe("RoutineReadingView — collapsible sections", () => {
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

  const twoSectionRoutine = (): RoutineDoc => ({
    id: "r1",
    title: "Gold Waltz",
    dance: "waltz",
    ownerId: "u1",
    sections: [
      { id: "s1", name: "1st Long Side", placements: [{ id: "p1", figureRef: "f1" }] },
      { id: "s2", name: "Corner", placements: [{ id: "p2", figureRef: "f2" }] },
    ],
    annotations: [],
    schemaVersion: 1,
  });

  const twoSectionPlacements = (f1: FigureDoc, f2: FigureDoc): ResolvedPlacement[] => [
    { placement: { id: "p1", figureRef: "f1" }, figure: f1, status: "live" },
    { placement: { id: "p2", figureRef: "f2" }, figure: f2, status: "live" },
  ];

  /** Drives the CONTROLLED collapse props the way Assemble does (one shared
   *  Set for both lenses) — the component itself stays stateless about it. */
  function Harness() {
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    return (
      <RoutineReadingView
        routine={twoSectionRoutine()}
        placements={twoSectionPlacements(
          threeStep("f1", "Natural Turn"),
          threeStep("f2", "Reverse Turn"),
        )}
        roleView="leader"
        collapsedSections={collapsed}
        onToggleSection={(id) => {
          setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }}
      />
    );
  }

  it("folds a section's figures behind its divider and expands them back", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderUi(<Harness />);
    // Both sections start expanded.
    expect(screen.getByText("Natural Turn")).toBeInTheDocument();
    expect(screen.getByText("Reverse Turn")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Collapse 1st Long Side" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);
    // The folded section hides its figures but keeps its divider + a fig count;
    // the OTHER section is untouched.
    expect(screen.queryByText("Natural Turn")).toBeNull();
    expect(screen.getByText("1st Long Side")).toBeInTheDocument();
    expect(screen.getByText("1 fig")).toBeInTheDocument();
    expect(screen.getByText("Reverse Turn")).toBeInTheDocument();
    const expand = screen.getByRole("button", { name: "Expand 1st Long Side" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(expand);
    expect(screen.getByText("Natural Turn")).toBeInTheDocument();
  });

  it("keeps the continuous beat numbering intact while a section is folded", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderUi(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse 1st Long Side" }));
    // Folding is display-only: the second section's figure still numbers its
    // beats AFTER the hidden section's span (4 5 6), never restarting at 1.
    expect(screen.getByText("4 5 6")).toBeInTheDocument();
  });

  it("renders plain, non-interactive dividers when no onToggleSection is wired", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderReading(figure({ attributes: [attr(1, "direction", "forward")] }));
    expect(screen.getByText("1st Long Side")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /collapse 1st long side/i })).toBeNull();
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
    const stored: unknown = JSON.parse(localStorage.getItem("bb_read_columns") ?? "[]");
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

// attribute-predicate-anchors — predicate notes surface on matching step rows
// (docs/concepts/annotations.md § Anchors). matchPredicate runs over the already-
// resolved figure; the note folds into the same margin count cell as a timed family
// note. Referential stability: an unrelated change keeps the per-figure slice identity.
describe("RoutineReadingView — predicate notes surface on matching steps", () => {
  // A 3-count figure with a left sway on counts 1 and 3, a right sway on 2.
  const swayFigure = (): FigureDoc =>
    figure({
      id: "f1",
      figureType: "feather",
      name: "Feather",
      counts: 3,
      attributes: [attr(1, "sway", "to_L"), attr(2, "sway", "to_R"), attr(3, "sway", "to_L")],
    });

  const predicateNote = (over: Partial<PredicateNote>): PredicateNote => ({
    id: "pn1",
    authorId: "coach",
    kind: "note",
    text: "soften this sway",
    attrKind: "sway",
    attrValue: "to_L",
    scope: "waltz",
    anchors: [{ type: "attributePredicate", kind: "sway", value: "to_L", scope: "waltz" }],
    createdAt: 5,
    ...over,
  });

  function renderWithPredicate(extra: Partial<ReadingProps>, fig = swayFigure()) {
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

  it("surfaces a value note on every matching count row, not on non-matching ones", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderWithPredicate({ predicateNotes: [predicateNote({ text: "soften every left sway" })] });
    // Left sway is on counts 1 and 3 → the note surfaces there.
    expect(screen.getByRole("button", { name: /notes — count 1/i })).toHaveTextContent(
      "soften every left sway",
    );
    expect(screen.getByRole("button", { name: /notes — count 3/i })).toHaveTextContent(
      "soften every left sway",
    );
    // Count 2 (a right sway) does NOT carry it.
    expect(screen.getByRole("button", { name: /notes — count 2/i })).not.toHaveTextContent(
      "soften every left sway",
    );
  });

  it("#285: announces a predicate note with its OWN scope cue, not the family one", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderWithPredicate({ predicateNotes: [predicateNote({ text: "soften every left sway" })] });
    // The matched count's margin cell announces the predicate note as an ATTRIBUTE
    // note (its distinct anchor type), never miscategorized as a "Family note:".
    const cell = screen.getByRole("button", { name: /notes — count 1/i });
    expect(cell).toHaveTextContent("Attribute note:");
    expect(cell).not.toHaveTextContent("Family note:");
  });

  it("surfaces a `none` note on the counts carrying no matching value", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    // A figure with a rise only on count 1 → a "no rise logged" note surfaces on 2, 3.
    const riseFig = figure({
      id: "f1",
      figureType: "feather",
      name: "Feather",
      counts: 3,
      attributes: [attr(1, "rise", "commence"), attr(2, "sway", "to_L"), attr(3, "sway", "to_L")],
    });
    renderWithPredicate(
      {
        predicateNotes: [
          predicateNote({
            attrKind: "rise",
            attrValue: "none",
            text: "no rise logged here",
            anchors: [{ type: "attributePredicate", kind: "rise", value: "none", scope: "waltz" }],
          }),
        ],
      },
      riseFig,
    );
    expect(screen.getByRole("button", { name: /notes — count 2/i })).toHaveTextContent(
      "no rise logged here",
    );
    expect(screen.getByRole("button", { name: /notes — count 1/i })).not.toHaveTextContent(
      "no rise logged here",
    );
  });

  it("only surfaces a routine-scoped note on its own routine", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    renderWithPredicate({
      predicateNotes: [
        predicateNote({
          text: "just here",
          scope: "routine",
          anchors: [
            {
              type: "attributePredicate",
              kind: "sway",
              value: "to_L",
              scope: "routine",
              routineRef: "OTHER_ROUTINE",
            },
          ],
        }),
      ],
    });
    // The anchor is confined to OTHER_ROUTINE, so it never surfaces on r1.
    expect(screen.getByRole("button", { name: /notes — count 1/i })).not.toHaveTextContent(
      "just here",
    );
  });

  it("keeps the matched-note surfacing stable when an unrelated prop changes (referential stability)", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const fig = swayFigure();
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
    // The SAME predicateNotes array identity across renders — the memo must not
    // re-slice (the first content-dependent read path's flicker guard). We assert
    // the surfaced note is stable across an unrelated re-render (roleView flip back).
    const notes = [predicateNote({ text: "soften every left sway" })];
    const { rerender } = renderUi(
      <RoutineReadingView
        routine={routine}
        placements={[{ placement: { id: "p1", figureRef: fig.id }, figure: fig, status: "live" }]}
        roleView="leader"
        predicateNotes={notes}
      />,
    );
    expect(screen.getByRole("button", { name: /notes — count 1/i })).toHaveTextContent(
      "soften every left sway",
    );
    // Re-render with an unrelated prop toggled twice back to leader — the note stays.
    rerender(
      <RoutineReadingView
        routine={routine}
        placements={[{ placement: { id: "p1", figureRef: fig.id }, figure: fig, status: "live" }]}
        roleView="follower"
        predicateNotes={notes}
      />,
    );
    rerender(
      <RoutineReadingView
        routine={routine}
        placements={[{ placement: { id: "p1", figureRef: fig.id }, figure: fig, status: "live" }]}
        roleView="leader"
        predicateNotes={notes}
      />,
    );
    expect(screen.getByRole("button", { name: /notes — count 1/i })).toHaveTextContent(
      "soften every left sway",
    );
  });

  it("#284: re-slices when a figure's CONTENT changes under a stable id (drops a note whose value was retagged)", async () => {
    // Regression (issue #284): after an in-place edit retags a matching step's
    // value, the SAME figure id now resolves to different content. The
    // referential-stability cache must re-slice — reusing the prior match set on
    // an id whose content changed would keep the note on a count that no longer
    // matches (exactly the QA symptom: display flips to the new value, the note
    // clings to the old one). This is the component-level twin of the store test.
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    // Before: left sway on count 2 → the note matches count 2.
    const before = figure({
      id: "fx",
      figureType: "whisk",
      name: "Whisk",
      counts: 3,
      attributes: [attr(1, "sway", "to_R"), attr(2, "sway", "to_L")],
    });
    const routine: RoutineDoc = {
      id: "r1",
      title: "Gold Waltz",
      dance: "waltz",
      ownerId: "u1",
      sections: [{ id: "s1", name: "1st Long Side", placements: [{ id: "p1", figureRef: "fx" }] }],
      annotations: [],
      schemaVersion: 1,
    };
    const notes = [predicateNote({ text: "soften every left sway" })];
    const { rerender } = renderUi(
      <RoutineReadingView
        routine={routine}
        placements={[{ placement: { id: "p1", figureRef: "fx" }, figure: before, status: "live" }]}
        roleView="leader"
        predicateNotes={notes}
      />,
    );
    expect(screen.getByRole("button", { name: /notes — count 2/i })).toHaveTextContent(
      "soften every left sway",
    );

    // After: the SAME figure id, count 2 retagged to right (both counts right now).
    const after = figure({
      id: "fx",
      figureType: "whisk",
      name: "Whisk",
      counts: 3,
      attributes: [attr(1, "sway", "to_R"), attr(2, "sway", "to_R")],
    });
    rerender(
      <RoutineReadingView
        routine={routine}
        placements={[{ placement: { id: "p1", figureRef: "fx" }, figure: after, status: "live" }]}
        roleView="leader"
        predicateNotes={notes}
      />,
    );
    // The note must DROP from count 2 — no left sway exists on any count anymore.
    expect(screen.getByRole("button", { name: /notes — count 2/i })).not.toHaveTextContent(
      "soften every left sway",
    );
  });

  it("#284: matches over the ACTIVE ROLE LENS — a mirrored split doesn't surface the hidden side", async () => {
    // Regression (issue #284, root cause): a Both-lens sway edit splits into
    // leader `to_R` + follower `to_L` (the same physical lean — sway MIRRORS,
    // WEP-0008). Under the leader lens the reading table shows only "R" on that
    // count, so a `to_L` note must NOT surface there (it clung in #284 because
    // matchPredicate ran over the UNFILTERED figure and caught the hidden follower
    // value). Under the follower lens the same note DOES surface — the follower
    // genuinely sways left there.
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    // Count 2: a split sway (leader right, follower left) — a variant Both-edit.
    const split = figure({
      id: "fsplit",
      figureType: "whisk",
      name: "Whisk",
      counts: 3,
      attributes: [attr(2, "sway", "to_R", "leader"), attr(2, "sway", "to_L", "follower")],
    });
    const routine: RoutineDoc = {
      id: "r1",
      title: "Gold Waltz",
      dance: "waltz",
      ownerId: "u1",
      sections: [
        { id: "s1", name: "1st Long Side", placements: [{ id: "p1", figureRef: "fsplit" }] },
      ],
      annotations: [],
      schemaVersion: 1,
    };
    const notes = [predicateNote({ text: "soften every left sway" })]; // attrValue to_L, role Both
    const { rerender } = renderUi(
      <RoutineReadingView
        routine={routine}
        placements={[
          { placement: { id: "p1", figureRef: "fsplit" }, figure: split, status: "live" },
        ]}
        roleView="leader"
        predicateNotes={notes}
      />,
    );
    // Leader lens: count 2 shows the leader's RIGHT sway → the left-sway note is absent.
    expect(screen.getByRole("button", { name: /notes — count 2/i })).not.toHaveTextContent(
      "soften every left sway",
    );

    // Follower lens: count 2 shows the follower's LEFT sway → the note surfaces.
    rerender(
      <RoutineReadingView
        routine={routine}
        placements={[
          { placement: { id: "p1", figureRef: "fsplit" }, figure: split, status: "live" },
        ]}
        roleView="follower"
        predicateNotes={notes}
      />,
    );
    expect(screen.getByRole("button", { name: /notes — count 2/i })).toHaveTextContent(
      "soften every left sway",
    );
  });

  it("is axe-clean with predicate notes folded into the margin", async () => {
    ({ RoutineReadingView } = await importComponent<ReadingModule>(
      "../components/RoutineReadingView",
    ));
    const { container } = renderWithPredicate({
      predicateNotes: [predicateNote({ text: "soften every left sway" })],
    });
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
