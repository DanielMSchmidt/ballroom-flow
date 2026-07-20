// attribute-predicate-anchors — the fourth Anchor variant (docs/concepts/annotations.md
// § Anchors — what a note points at). zAnchor is a discriminatedUnion pinned by
// z.ZodType<Anchor>, so the union and the schema move in ONE commit; readers stay lenient
// by structure (they filter on anchor.type), which this file also pins for the existing corpus.
//
// INVARIANT: an attributePredicate anchor round-trips through parseAnchors; a routine-scoped
// anchor requires exactly its routineRef; the v1 three-variant corpus keeps parsing unchanged.
import { describe, expect, it } from "vitest";
import { addPredicateNote, buildAccountDoc, readAccount } from "./doc-account";
import { CURRENT_SCHEMA_VERSION } from "./migrations";
import { parseAnchors } from "./schemas";

const predicate = {
  type: "attributePredicate",
  kind: "sway",
  value: "left",
  role: "leader",
  scope: "waltz",
} as const;

describe("attributePredicate anchor: schema", () => {
  it("round-trips an attributePredicate anchor through parseAnchors", () => {
    expect(parseAnchors([predicate])).toEqual([predicate]);
    expect(
      parseAnchors([{ type: "attributePredicate", kind: "sway", value: "none", scope: "all" }]),
    ).toEqual([{ type: "attributePredicate", kind: "sway", value: "none", scope: "all" }]);
  });

  it("keeps the whole v1 corpus parsing unchanged (leniency regression)", () => {
    const corpus = [
      { type: "point", figureRef: "f1", count: 2 },
      { type: "figure", figureRef: "f1" },
      { type: "figureType", figureType: "whisk", danceScope: "waltz", count: 3, role: "leader" },
    ] as const;
    expect(parseAnchors([...corpus])).toEqual([...corpus]);
  });

  it("requires routineRef exactly when scope is 'routine'", () => {
    expect(
      parseAnchors([{ type: "attributePredicate", kind: "sway", value: "left", scope: "routine" }]),
    ).toBeNull(); // routine scope without a routineRef is unresolvable
    expect(
      parseAnchors([
        {
          type: "attributePredicate",
          kind: "sway",
          value: "left",
          scope: "routine",
          routineRef: "r1",
        },
      ]),
    ).not.toBeNull();
    expect(
      parseAnchors([
        {
          type: "attributePredicate",
          kind: "sway",
          value: "left",
          scope: "waltz",
          routineRef: "r1",
        },
      ]),
    ).toBeNull(); // a stray routineRef on a dance/all scope is rejected — anchors stay canonical
  });
});

describe("addPredicateNote", () => {
  it("pushes an annotation carrying ONE attributePredicate anchor, ULID id, no tombstone", () => {
    const doc = buildAccountDoc({
      id: "acct",
      ownerId: "u1",
      annotations: [],
      libraryFigureRefs: [],
      schemaVersion: CURRENT_SCHEMA_VERSION,
      deletedAt: null,
    });
    const after = addPredicateNote(doc, {
      authorId: "u1",
      kind: "note",
      text: "soften it",
      attrKind: "sway",
      attrValue: "left",
      attrRole: "leader",
      scope: "waltz",
    });
    const [a] = readAccount(after).annotations;
    expect(a?.anchors).toEqual([
      { type: "attributePredicate", kind: "sway", value: "left", role: "leader", scope: "waltz" },
    ]);
    expect(a?.authorId).toBe("u1");
    expect(a?.deletedAt ?? null).toBeNull();
  });
});
