// US-039 — routine annotation mutators (PLAN §4.6).
import { describe, expect, it } from "vitest";
import {
  addAnnotation,
  addReply,
  buildRoutineDoc,
  readRoutine,
  softDeleteAnnotation,
  softDeleteReply,
} from "./doc-routine";
import type { RoutineDoc } from "./doc-types";

const base = (): RoutineDoc => ({
  id: "r1",
  title: "T",
  dance: "waltz",
  ownerId: "u1",
  sections: [],
  annotations: [],
  schemaVersion: 1,
  deletedAt: null,
});

describe("routine annotation mutators", () => {
  it("adds a kinded annotation anchored to a point", () => {
    let doc = buildRoutineDoc(base());
    doc = addAnnotation(doc, {
      authorId: "u1",
      kind: "lesson",
      text: "rise earlier",
      anchors: [{ type: "point", figureRef: "f1", count: 2, role: "leader" }],
    });
    const r = readRoutine(doc);
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0]).toMatchObject({ kind: "lesson", text: "rise earlier", replies: [] });
    expect(r.annotations[0]?.anchors[0]).toMatchObject({
      type: "point",
      figureRef: "f1",
      count: 2,
    });
  });

  it("threads ordered replies", () => {
    let doc = buildRoutineDoc(base());
    doc = addAnnotation(doc, {
      authorId: "u1",
      kind: "note",
      text: "n",
      anchors: [{ type: "figure", figureRef: "f1" }],
    });
    const id = readRoutine(doc).annotations[0]?.id ?? "";
    doc = addReply(doc, id, { authorId: "u2", text: "first" });
    doc = addReply(doc, id, { authorId: "u1", text: "second" });
    expect(readRoutine(doc).annotations[0]?.replies.map((x) => x.text)).toEqual([
      "first",
      "second",
    ]);
  });

  it("soft-deletes an annotation and a reply (tombstone, merges)", () => {
    let doc = buildRoutineDoc(base());
    doc = addAnnotation(doc, {
      authorId: "u1",
      kind: "note",
      text: "n",
      anchors: [{ type: "figure", figureRef: "f1" }],
    });
    const id = readRoutine(doc).annotations[0]?.id ?? "";
    doc = addReply(doc, id, { authorId: "u1", text: "r" });
    const replyId = readRoutine(doc).annotations[0]?.replies[0]?.id ?? "";
    doc = softDeleteReply(doc, id, replyId);
    expect(readRoutine(doc).annotations[0]?.replies).toHaveLength(0);
    doc = softDeleteAnnotation(doc, id);
    expect(readRoutine(doc).annotations).toHaveLength(0);
    expect(readRoutine(doc, { includeDeleted: true }).annotations[0]?.deletedAt).toBeTypeOf(
      "number",
    );
  });
});
