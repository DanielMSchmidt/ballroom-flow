import { describe, expect, it } from "vitest";
import { zCreateFigure, zJournalList, zRegistryKind, zSearchResults, zTemplateList } from "./index";

describe("zJournalList (T6)", () => {
  it("parses a UNION of routine + account journal entries with resolved anchor labels", () => {
    const parsed = zJournalList.parse({
      entries: [
        {
          id: "a1",
          routineRef: "rt_1",
          authorId: "coach",
          kind: "lesson",
          text: "head left through the natural turn",
          anchors: [
            { type: "point", figureRef: "fig_nt", count: 1, label: "Natural Turn · step 2" },
            { type: "figureType", figureType: "whisk", danceScope: "all", label: "all Whisks" },
          ],
          createdAt: 1000,
          displayName: "Anna",
          identityColor: "#1f8a5b",
          source: "routine",
        },
        {
          id: "n1",
          routineRef: "account:me",
          authorId: "me",
          kind: "practice",
          text: "spin not rushing",
          anchors: [{ type: "figureType", figureType: "whisk", danceScope: "waltz" }],
          createdAt: 900,
          displayName: null,
          identityColor: null,
          source: "account",
        },
      ],
    });
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]?.anchors[0]?.label).toBe("Natural Turn · step 2");
  });

  it("rejects a non-lesson/practice kind (journal is lesson|practice only)", () => {
    expect(
      zJournalList.safeParse({
        entries: [
          {
            id: "x",
            routineRef: "rt",
            authorId: "u",
            kind: "note",
            text: "t",
            anchors: [],
            createdAt: 1,
            displayName: null,
            identityColor: null,
            source: "routine",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("zCreateFigure", () => {
  it("accepts an optional attributes timeline, defaulting to []", () => {
    const base = {
      figureRef: "fig_1",
      name: "Natural Turn",
      dance: "waltz",
      figureType: "natural-turn",
      routineId: "rt_1",
    };
    expect(zCreateFigure.parse(base).attributes).toEqual([]);

    const withAttrs = zCreateFigure.parse({
      ...base,
      attributes: [
        { id: "a1", kind: "step", count: 1, role: null, value: "RF fwd", deletedAt: null },
      ],
    });
    expect(withAttrs.attributes).toHaveLength(1);
  });

  it("rejects a structurally invalid attribute", () => {
    const bad = {
      figureRef: "fig_1",
      name: "X",
      dance: "waltz",
      figureType: "x",
      routineId: "rt_1",
      attributes: [{ id: "a1", count: 1 }], // missing kind/value
    };
    expect(zCreateFigure.safeParse(bad).success).toBe(false);
  });
});

it("US-043 validates a custom registry kind", () => {
  const ok = zRegistryKind.safeParse({
    kind: "energy",
    label: "Energy",
    color: "#c0563f",
    cardinality: "single",
    valueType: "enum",
    values: ["low", "high"],
    builtin: false,
  });
  expect(ok.success).toBe(true);
});

it("US-046 shapes search results", () => {
  const ok = zSearchResults.safeParse({
    results: [{ docRef: "r1", type: "routine", title: "My Foxtrot", dance: "foxtrot" }],
  });
  expect(ok.success).toBe(true);
});

it("US-046 search result accepts a null dance (nullable, not optional)", () => {
  // dance is .nullable() — a global figure may project a null dance, but the
  // field must always be PRESENT. Lock both: null is accepted, omission is not.
  const withNull = zSearchResults.safeParse({
    results: [{ docRef: "f1", type: "global-figure", title: "Feather", dance: null }],
  });
  expect(withNull.success).toBe(true);
  const omitted = zSearchResults.safeParse({
    results: [{ docRef: "f1", type: "global-figure", title: "Feather" }],
  });
  expect(omitted.success).toBe(false);
});

it("US-045 shapes the template list", () => {
  const ok = zTemplateList.safeParse({
    templates: [{ docRef: "t1", title: "Sample", dance: "foxtrot", role: "viewer", updatedAt: 1 }],
  });
  expect(ok.success).toBe(true);
});
