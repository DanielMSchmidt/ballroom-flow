// T6 — pure journal list helpers (no I/O). Filters + by-figure grouping.
import { describe, expect, it } from "vitest";
import {
  applyJournalFilter,
  chipLabel,
  figureFamilies,
  type JournalEntry,
  relativeDate,
} from "./journal";

const entry = (over: Partial<JournalEntry>): JournalEntry => ({
  id: "e",
  routineRef: "rt",
  authorId: "u",
  kind: "lesson",
  text: "t",
  anchors: [],
  createdAt: 0,
  displayName: "Anna",
  identityColor: "#1f8a5b",
  source: "routine",
  ...over,
});

describe("applyJournalFilter", () => {
  const list: JournalEntry[] = [
    entry({ id: "l1", kind: "lesson", createdAt: 30 }),
    entry({ id: "p1", kind: "practice", createdAt: 20 }),
    entry({ id: "l2", kind: "lesson", createdAt: 10 }),
  ];

  it("all → identity (unchanged order)", () => {
    expect(applyJournalFilter(list, "all").map((e) => e.id)).toEqual(["l1", "p1", "l2"]);
  });

  it("lessons → only lesson entries", () => {
    expect(applyJournalFilter(list, "lessons").map((e) => e.id)).toEqual(["l1", "l2"]);
  });

  it("practice → only practice entries", () => {
    expect(applyJournalFilter(list, "practice").map((e) => e.id)).toEqual(["p1"]);
  });

  it("byFigure → sorts by figure/family name, anchorless last", () => {
    const withAnchors: JournalEntry[] = [
      entry({ id: "noLink", anchors: [], createdAt: 99 }),
      entry({
        id: "whisk",
        anchors: [
          { type: "figureType", figureType: "whisk", danceScope: "all", label: "all Whisks" },
        ],
      }),
      entry({
        id: "natural",
        anchors: [{ type: "figure", figureRef: "f1", label: "Natural Turn" }],
      }),
    ];
    const ordered = applyJournalFilter(withAnchors, "byFigure").map((e) => e.id);
    // "Natural Turn" < "whisk" by name; the anchorless entry sorts LAST.
    expect(ordered).toEqual(["natural", "whisk", "noLink"]);
  });

  it("byFigure with an empty list returns []", () => {
    expect(applyJournalFilter([], "byFigure")).toEqual([]);
  });
});

describe("chipLabel", () => {
  it("uses the server-resolved label when present", () => {
    expect(
      chipLabel({ type: "point", figureRef: "f", count: 1, label: "Natural Turn · step 2" }),
    ).toBe("Natural Turn · step 2");
  });
  it("falls back to a generic step label for a point anchor with no label", () => {
    expect(chipLabel({ type: "point", figureRef: "f", count: 1 })).toBe("step 2");
  });
});

describe("relativeDate", () => {
  const now = new Date(2026, 4, 10, 12, 0, 0).getTime(); // 10 May 2026
  it("today / yesterday / weekday / date", () => {
    expect(relativeDate(now, now)).toBe("today");
    expect(relativeDate(new Date(2026, 4, 9, 8).getTime(), now)).toBe("yesterday");
    // 3 May is a week+ before 10 May → an explicit date.
    expect(relativeDate(new Date(2026, 4, 3).getTime(), now)).toBe("May 3");
  });
});

describe("figureFamilies", () => {
  it("returns distinct families from the catalog with a count", () => {
    const families = figureFamilies();
    expect(families.length).toBeGreaterThan(3);
    // No duplicate figureType.
    const types = families.map((f) => f.figureType);
    expect(new Set(types).size).toBe(types.length);
    expect(families[0]).toHaveProperty("name");
    expect(families[0]).toHaveProperty("dance");
  });
});
