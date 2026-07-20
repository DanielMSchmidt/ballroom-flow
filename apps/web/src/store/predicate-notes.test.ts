// attribute-predicate-anchors — the predicate-note store seam (docs/concepts/annotations.md
// § Anchors). loadPredicateNotes hits the co-member REST route; mergePredicateNotes folds
// own live notes (self-read, offline-capable) into the co-member rows, deduped by id (REST
// wins), filtered to those applying to the routine. Components reach this ONLY via the store.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OwnPredicateNote } from "./account";
import { loadPredicateNotes, mergePredicateNotes, type PredicateNote } from "./predicate-notes";

afterEach(() => {
  vi.unstubAllGlobals();
});

const own = (over: Partial<OwnPredicateNote>): OwnPredicateNote => ({
  id: "o1",
  authorId: "u1",
  kind: "note",
  text: "own",
  attrKind: "sway",
  attrValue: "left",
  scope: "waltz",
  createdAt: 1,
  ...over,
});

const rest = (over: Partial<PredicateNote>): PredicateNote => ({
  id: "r1",
  authorId: "coach",
  kind: "note",
  text: "rest",
  attrKind: "sway",
  attrValue: "left",
  scope: "waltz",
  anchors: [{ type: "attributePredicate", kind: "sway", value: "left", scope: "waltz" }],
  ...over,
});

describe("loadPredicateNotes", () => {
  it("GETs the predicate-notes route with the token and returns notes", async () => {
    const notes = [rest({ id: "r1" })];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ notes }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const got = await loadPredicateNotes("rt1", "tok", "http://test");
    expect(got).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test/api/routines/rt1/predicate-notes",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
  });
});

describe("mergePredicateNotes", () => {
  it("dedupes by id with the REST row winning", () => {
    const merged = mergePredicateNotes(
      [rest({ id: "shared", text: "from-rest" })],
      [own({ id: "shared", text: "from-own" })],
      "u1",
      "rt1",
      "waltz",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("from-rest");
  });

  it("adds an own note not present in the REST rows, shaped with an attributePredicate anchor", () => {
    const merged = mergePredicateNotes(
      [],
      [own({ id: "o1", attrValue: "left", role: "leader" })],
      "u1",
      "rt1",
      "waltz",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.anchors[0]).toMatchObject({
      type: "attributePredicate",
      kind: "sway",
      value: "left",
      role: "leader",
      scope: "waltz",
    });
  });

  it("filters own notes by scope applicability (dance / all / matching routineRef)", () => {
    const notes = [
      own({ id: "a", scope: "all" }),
      own({ id: "b", scope: "waltz" }),
      own({ id: "c", scope: "foxtrot" }),
      own({ id: "d", scope: "routine", routineRef: "rt1" }),
      own({ id: "e", scope: "routine", routineRef: "OTHER" }),
    ];
    const merged = mergePredicateNotes([], notes, "u1", "rt1", "waltz");
    const ids = merged.map((n) => n.id).sort();
    expect(ids).toEqual(["a", "b", "d"]);
  });

  it("is a no-op (returns the co-member array) for empty own input or no user", () => {
    const co = [rest({ id: "r1" })];
    expect(mergePredicateNotes(co, [], "u1", "rt1", "waltz")).toBe(co);
    expect(mergePredicateNotes(co, [own({})], undefined, "rt1", "waltz")).toBe(co);
  });
});
