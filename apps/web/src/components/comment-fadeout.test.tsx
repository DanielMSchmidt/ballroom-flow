// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role.
//
// Comment activity fade-out — thread panel + notes margin (reading view only).
// docs/concepts/annotations.md § Where notes appear. EVERY render injects `now`
// (first wall-clock-dependent rendering — the rule, not a convenience).
import type { Annotation, Attribute, FigureDoc, RoutineDoc } from "@weavesteps/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnnotationPanel } from "../components/AnnotationPanel";
import { RoutineReadingView } from "../components/RoutineReadingView";
import { resetLocaleForTests, setLocale } from "../i18n";
import type { FamilyNote } from "../store/family-notes";
import type { ResolvedPlacement } from "../store/routine";
import { axeCheck, renderUi, screen, userEvent } from "../test-support/render";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const ann = (over: Partial<Annotation>): Annotation => ({
  id: "a1",
  authorId: "u1",
  kind: "note",
  text: "note text",
  tags: [],
  anchors: [],
  replies: [],
  createdAt: 0,
  deletedAt: null,
  ...over,
});

/** The comeback burst: 9 settled May comments (68–73d) + one fresh comment. */
function comebackThread(): Annotation[] {
  const may = Array.from({ length: 9 }, (_, i) =>
    ann({
      id: `may${i}`,
      authorId: "coach",
      text: `settled May note ${i + 1}`,
      createdAt: NOW - (73 - i) * DAY,
    }),
  );
  const fresh = ann({
    id: "fresh",
    authorId: "partner",
    text: "arm line collapsed again",
    createdAt: NOW - 60 * 60 * 1000,
  });
  return [...may, fresh];
}

describe("comment fade-out — thread panel (reading view)", () => {
  afterEach(() => resetLocaleForTests());

  it("comeback burst: only the fresh comment shows; 9 stale collapse behind a counted divider", () => {
    renderUi(
      <AnnotationPanel
        role="commenter"
        threadTitle="Whisk · step 3"
        annotations={comebackThread()}
        now={NOW}
      />,
    );
    expect(screen.getByText("arm line collapsed again")).toBeInTheDocument();
    expect(screen.queryByText("settled May note 1")).toBeNull();
    const divider = screen.getByRole("button", { name: "9 more comments" });
    expect(divider).toHaveAttribute("aria-expanded", "false");
  });

  it("expand-in-place shows all ten in original order, then collapses again", async () => {
    renderUi(
      <AnnotationPanel
        role="commenter"
        threadTitle="Whisk · step 3"
        annotations={comebackThread()}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "9 more comments" }));
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(10);
    expect(items[0]).toHaveTextContent("settled May note 1");
    expect(items[9]).toHaveTextContent("arm line collapsed again");
    const collapse = screen.getByRole("button", { name: /showing all · collapse older/i });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(collapse);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "9 more comments" })).toBeInTheDocument();
  });

  it("all-recent list (≤5d) shows every comment with no divider", () => {
    renderUi(
      <AnnotationPanel
        role="commenter"
        threadTitle="Whisk · step 3"
        annotations={[
          ann({ id: "c1", text: "first", createdAt: NOW - 5 * DAY }),
          ann({ id: "c2", text: "second", createdAt: NOW - 2 * DAY }),
          ann({ id: "c3", text: "third", createdAt: NOW - 1 * DAY }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.getByText("third")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /more comment/i })).toBeNull();
  });

  it("all-within-session list (45d + 42d, nothing newer) shows both, no divider", () => {
    renderUi(
      <AnnotationPanel
        role="commenter"
        threadTitle="Whisk · step 3"
        annotations={[
          ann({ id: "q1", text: "quiet one", createdAt: NOW - 45 * DAY }),
          ann({ id: "q2", text: "quiet two", createdAt: NOW - 42 * DAY }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByText("quiet one")).toBeInTheDocument();
    expect(screen.getByText("quiet two")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /more comment/i })).toBeNull();
  });

  it("a reply reactivates its thread; divider reads the singular count", () => {
    renderUi(
      <AnnotationPanel
        role="commenter"
        threadTitle="Whisk · step 3"
        annotations={[
          ann({
            id: "replied",
            text: "old but revived",
            createdAt: NOW - 70 * DAY,
            replies: [
              { id: "r", authorId: "u2", text: "today", createdAt: NOW - 1 * DAY, deletedAt: null },
            ],
          }),
          ann({ id: "stale", text: "genuinely stale", createdAt: NOW - 70 * DAY }),
          ann({ id: "fresh", text: "fresh one", createdAt: NOW - 1 * DAY }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByRole("button", { name: "1 more comment" })).toBeInTheDocument();
    expect(screen.getByText("old but revived")).toBeInTheDocument();
    expect(screen.queryByText("genuinely stale")).toBeNull();
  });

  it("keeps the header count honest to the full thread while collapsed", () => {
    renderUi(
      <AnnotationPanel
        role="commenter"
        threadTitle="Whisk · step 3"
        annotations={comebackThread()}
        now={NOW}
      />,
    );
    expect(screen.getByText(/10 comments/i)).toBeInTheDocument();
  });

  it("has no axe violations collapsed and expanded", async () => {
    const { container } = renderUi(
      <AnnotationPanel
        role="commenter"
        threadTitle="Whisk · step 3"
        annotations={comebackThread()}
        now={NOW}
      />,
    );
    expect(await axeCheck(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "9 more comments" }));
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});

describe("comment fade-out — i18n divider strings", () => {
  afterEach(() => resetLocaleForTests());

  it("en: singular divider reads '1 more comment'", () => {
    renderUi(
      <AnnotationPanel
        role="commenter"
        threadTitle="Whisk · step 3"
        annotations={[
          ann({ id: "stale", text: "stale", createdAt: NOW - 70 * DAY }),
          ann({ id: "fresh", text: "fresh", createdAt: NOW - 1 * DAY }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByRole("button", { name: "1 more comment" })).toBeInTheDocument();
  });

  it("de: plural divider + expanded bar are localized", async () => {
    setLocale("de");
    renderUi(
      <AnnotationPanel
        role="commenter"
        threadTitle="Whisk · step 3"
        annotations={comebackThread()}
        now={NOW}
      />,
    );
    const divider = screen.getByRole("button", { name: "9 weitere Kommentare" });
    expect(divider).toBeInTheDocument();
    await userEvent.click(divider);
    expect(
      screen.getByRole("button", { name: /alle angezeigt · ältere einklappen/i }),
    ).toBeInTheDocument();
  });

  it("de: singular divider reads '1 weiterer Kommentar'", () => {
    setLocale("de");
    renderUi(
      <AnnotationPanel
        role="commenter"
        threadTitle="Whisk · step 3"
        annotations={[
          ann({ id: "stale", text: "stale", createdAt: NOW - 70 * DAY }),
          ann({ id: "fresh", text: "fresh", createdAt: NOW - 1 * DAY }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByRole("button", { name: "1 weiterer Kommentar" })).toBeInTheDocument();
  });
});

// ── Notes margin — snippet/avatars from ACTIVE routine comments only ──────────

const attr = (count: number, kind: string, value: unknown): Attribute => ({
  id: `${kind}-${count}-${String(value)}`,
  kind,
  count,
  value,
  role: null,
  deletedAt: null,
});

const marginFigure: FigureDoc = {
  id: "f1",
  scope: "global",
  ownerId: "u1",
  figureType: "whisk",
  dance: "waltz",
  name: "Whisk",
  source: "library",
  attributes: [attr(1, "footwork", "HT")],
  schemaVersion: 1,
};

function pointNote(id: string, authorId: string, text: string, createdAt: number): Annotation {
  return {
    id,
    authorId,
    kind: "note",
    text,
    tags: [],
    anchors: [{ type: "point", figureRef: "f1", count: 1 }],
    replies: [],
    createdAt,
    deletedAt: null,
  };
}

function renderMargin(props: {
  annotations?: Annotation[];
  familyNotes?: FamilyNote[];
  memberColors?: Record<string, string>;
  memberNames?: Record<string, string>;
}) {
  const routine: RoutineDoc = {
    id: "r1",
    title: "Comp Waltz",
    dance: "waltz",
    ownerId: "u1",
    sections: [{ id: "s1", name: "Intro", placements: [{ id: "p1", figureRef: "f1" }] }],
    annotations: [],
    schemaVersion: 1,
  };
  const placements: ResolvedPlacement[] = [
    { placement: { id: "p1", figureRef: "f1" }, figure: marginFigure, status: "live" },
  ];
  return renderUi(
    <RoutineReadingView
      routine={routine}
      placements={placements}
      roleView="leader"
      now={NOW}
      {...props}
    />,
  );
}

describe("comment fade-out — notes margin (reading view)", () => {
  beforeEach(() => localStorage.clear());

  it("comeback margin: cell shows the fresh snippet + only the fresh author's avatar", () => {
    const may = Array.from({ length: 9 }, (_, i) =>
      pointNote(`may${i}`, "coach", `settled May note ${i + 1}`, NOW - (73 - i) * DAY),
    );
    renderMargin({
      memberColors: { coach: "#111111", partner: "#1f8a5b" },
      memberNames: { coach: "Coach", partner: "Dani" },
      annotations: [...may, pointNote("fresh", "partner", "arm line collapsed again", NOW - DAY)],
    });
    const cell = screen.getByRole("button", { name: /notes — count 1/i });
    expect(cell).toHaveTextContent("arm line collapsed again");
    expect(cell).not.toHaveTextContent("settled May note");
    // Only the fresh (active) comment's author avatar renders — not the 9 stale coach ones.
    expect(cell.querySelectorAll("span[data-avatar]")).toHaveLength(1);
  });

  it("quiet cluster: three >28d comments in one session all render (session window)", () => {
    renderMargin({
      memberColors: { a: "#100000", b: "#001000", c: "#000010" },
      memberNames: { a: "A", b: "B", c: "C" },
      annotations: [
        pointNote("q1", "a", "PP shape collapsing", NOW - 45 * DAY),
        pointNote("q2", "b", "lead from the back", NOW - 43 * DAY),
        pointNote("q3", "c", "keep the left side up", NOW - 42 * DAY),
      ],
    });
    const cell = screen.getByRole("button", { name: /notes — count 1/i });
    expect(cell).toHaveTextContent("keep the left side up"); // newest snippet
    expect(cell.querySelectorAll("span[data-avatar]")).toHaveLength(3);
  });

  it("reply reactivation: a 70d comment with a 1d live reply stays as the snippet", () => {
    const revived = pointNote("revived", "u2", "old but revived", NOW - 70 * DAY);
    revived.replies = [
      { id: "r", authorId: "u2", text: "today", createdAt: NOW - DAY, deletedAt: null },
    ];
    renderMargin({
      memberNames: { u2: "Nadia" },
      annotations: [revived],
    });
    const cell = screen.getByRole("button", { name: /notes — count 1/i });
    expect(cell).toHaveTextContent("old but revived");
  });

  it("family-note exemption: a 70d family note still renders alongside a fresh routine comment", () => {
    const familyNotes: FamilyNote[] = [
      {
        id: "fam1",
        authorId: "coach",
        kind: "note",
        text: "every whisk needs sway",
        figureType: "whisk",
        danceScope: "all",
        anchors: [{ type: "figureType", figureType: "whisk", danceScope: "all" }],
        createdAt: NOW - 70 * DAY,
      },
    ];
    renderMargin({
      memberColors: { coach: "#111111", partner: "#1f8a5b" },
      memberNames: { coach: "Coach", partner: "Dani" },
      familyNotes,
      annotations: [pointNote("fresh", "partner", "arm line collapsed", NOW - DAY)],
    });
    // The family note is exempt from fade-out — its content is present in a margin cell.
    expect(screen.getByText("every whisk needs sway")).toBeInTheDocument();
  });

  it("whole-figure header cell honors the rule: stale absent, fresh present", () => {
    const wholeNote = (id: string, text: string, createdAt: number): Annotation => ({
      id,
      authorId: "u2",
      kind: "note",
      text,
      tags: [],
      anchors: [{ type: "figure", figureRef: "f1" }],
      replies: [],
      createdAt,
      deletedAt: null,
    });
    renderMargin({
      memberNames: { u2: "Nadia" },
      annotations: [
        wholeNote("old", "stale whole-figure note", NOW - 70 * DAY),
        wholeNote("new", "fresh whole-figure note", NOW - DAY),
      ],
    });
    const header = screen.getByRole("button", { name: /notes — whisk/i });
    expect(header).toHaveTextContent("fresh whole-figure note");
    expect(header).not.toHaveTextContent("stale whole-figure note");
  });
});
