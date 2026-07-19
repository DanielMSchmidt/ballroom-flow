// T6 — pure journal list helpers (no I/O). Filters + by-figure grouping.
import { describe, expect, it } from "vitest";
import type { OwnFamilyNote } from "./account";
import {
  applyJournalFilter,
  chipLabel,
  type JournalEntry,
  mergeLiveFamilyNotes,
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
  it("appends the pinned count to an unlabelled TIMED figureType anchor (WEP-0004)", () => {
    expect(
      chipLabel({ type: "figureType", figureType: "whisk", danceScope: "waltz", count: 3 }),
    ).toBe("whisk · count 3");
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

// (The `figureFamilies` catalog helper was removed (docs/concepts/annotations.md
// § The Journal) — every journal link now starts from one of the user's
// choreos, so there is no catalog step.)

describe("mergeLiveFamilyNotes (WEP-0002 read-your-writes)", () => {
  const liveNote = (over: Partial<OwnFamilyNote>): OwnFamilyNote => ({
    id: "n1",
    kind: "lesson",
    text: "settle before the chassé",
    figureType: "whisk",
    danceScope: "waltz",
    createdAt: 100,
    ...over,
  });

  it("surfaces a live note the D1 projection has not caught up on, with the worker-parity label", () => {
    const merged = mergeLiveFamilyNotes([entry({ id: "r1", createdAt: 50 })], [liveNote({})], "u1");
    expect(merged.map((e) => e.id)).toEqual(["n1", "r1"]); // newest-first
    const note = merged[0];
    expect(note?.source).toBe("account");
    expect(note?.routineRef).toBe("account:u1");
    expect(note?.authorId).toBe("u1");
    expect(note?.anchors[0]?.label).toBe("all Whisks · all Waltz");
  });

  it("a TIMED live note (WEP-0004) carries count/role and the count-suffixed label", () => {
    const merged = mergeLiveFamilyNotes([], [liveNote({ count: 3, role: "leader" })], "u1");
    expect(merged[0]?.anchors[0]).toMatchObject({
      type: "figureType",
      figureType: "whisk",
      danceScope: "waltz",
      count: 3,
      role: "leader",
      label: "all Whisks · all Waltz · count 3",
    });
  });

  it("dedupes by id — a projection row that already caught up wins (it carries author display)", () => {
    const restRow = entry({ id: "n1", source: "account", displayName: "Dani", createdAt: 100 });
    const merged = mergeLiveFamilyNotes([restRow], [liveNote({})], "u1");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.displayName).toBe("Dani");
  });

  it("keeps plain 'note' kinds out of the journal (lesson/practice only, matching the read)", () => {
    expect(mergeLiveFamilyNotes([], [liveNote({ kind: "note" })], "u1")).toEqual([]);
  });

  it("no user id or no live notes → the REST list passes through untouched", () => {
    const rest = [entry({ id: "r1" })];
    expect(mergeLiveFamilyNotes(rest, [liveNote({})], undefined)).toBe(rest);
    expect(mergeLiveFamilyNotes(rest, [], "u1")).toBe(rest);
  });
});
