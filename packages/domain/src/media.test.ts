// docs/ideas/annotation-media-embeds.md — inline `![media:<id>]` tokens + CRDT
// semantics (append + tombstone list; the text field's merge behavior untouched).
//
// Invariant pinned: media placed inline in an annotation's plain text renders in
// order (live → embed, tombstoned/unknown → removed stub, unreferenced-live →
// appended, nothing silently lost); attach/tombstone are ordinary mergeable
// list ops that converge with concurrent text/tombstone edits; soft-delete only.
import { describe, expect, it } from "vitest";
import { applyMutations, exchangeAndAssertConverged } from "./__fixtures__";
import {
  addAnnotation,
  attachMedia,
  buildRoutineDoc,
  readRoutine,
  softDeleteMedia,
} from "./doc-routine";
import type { MediaItem, RoutineDoc } from "./doc-types";
import { mediaToken, splitMediaParts } from "./media";

const img = (id: string, deletedAt?: number): MediaItem => ({
  id,
  type: "image",
  objectKey: `media/r1/a1/${id}`,
  mimeType: "image/jpeg",
  sizeBytes: 1000,
  createdAt: 1,
  ...(deletedAt !== undefined ? { deletedAt } : {}),
});
const yt = (id: string): MediaItem => ({
  id,
  type: "youtube",
  videoId: "dQw4w9WgXcQ",
  url: "https://youtu.be/dQw4w9WgXcQ",
  createdAt: 1,
});

describe("splitMediaParts", () => {
  it("renders a live item inline at its token position", () => {
    const parts = splitMediaParts(`watch ${mediaToken("m1")} then compare`, [img("m1")]);
    expect(parts).toEqual([
      { kind: "text", text: "watch " },
      { kind: "media", item: img("m1") },
      { kind: "text", text: " then compare" },
    ]);
  });
  it("renders a tombstoned item as a removed stub", () => {
    const parts = splitMediaParts(mediaToken("m1"), [img("m1", 99)]);
    expect(parts).toEqual([{ kind: "removed", mediaId: "m1" }]);
  });
  it("renders a token referencing no item as a removed stub (hand-typed token)", () => {
    expect(splitMediaParts(mediaToken("nope"), [])).toEqual([{ kind: "removed", mediaId: "nope" }]);
  });
  it("appends a live item referenced nowhere (concurrent text edit ate the token)", () => {
    expect(splitMediaParts("plain text", [yt("m2")])).toEqual([
      { kind: "text", text: "plain text" },
      { kind: "media", item: yt("m2") },
    ]);
  });
  it("is a single text part when there is no media at all (lenient: media undefined)", () => {
    expect(splitMediaParts("no media here", undefined)).toEqual([
      { kind: "text", text: "no media here" },
    ]);
  });
});

describe("attachMedia / softDeleteMedia CRDT semantics", () => {
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
  const withAnnotation = () =>
    addAnnotation(buildRoutineDoc(base()), {
      authorId: "u1",
      kind: "note",
      text: "keep the head left",
      anchors: [],
    });

  it("concurrent attach vs text edit: both survive the merge", async () => {
    const doc = withAnnotation();
    const annId = readRoutine(doc).annotations[0]?.id ?? "";
    const left = attachMedia(doc, annId, img("m1"));
    const right = await applyMutations(doc, [
      (d) => {
        const a = d.annotations.find((x) => x.id === annId);
        if (a) a.text = `edited ${mediaToken("m1")}`;
      },
    ]);
    const { converged } = await exchangeAndAssertConverged(left, right);
    const ann = readRoutine(converged).annotations[0];
    expect(ann?.text).toContain("edited");
    expect(ann?.media?.map((m) => m.id)).toEqual(["m1"]);
  });

  it("concurrent attach vs annotation tombstone: converges, tombstone + media both present", async () => {
    const doc = withAnnotation();
    const annId = readRoutine(doc).annotations[0]?.id ?? "";
    const left = attachMedia(doc, annId, img("m1"));
    const right = await applyMutations(doc, [
      (d) => {
        const a = d.annotations.find((x) => x.id === annId);
        if (a) a.deletedAt = 42;
      },
    ]);
    const { converged } = await exchangeAndAssertConverged(left, right);
    const ann = readRoutine(converged, { includeDeleted: true }).annotations[0];
    expect(ann?.deletedAt).toBe(42);
    expect(ann?.media).toHaveLength(1); // media survives for undo/restore
  });

  it("concurrent attach vs media tombstone on another item: both effects land", async () => {
    const doc = withAnnotation();
    const annId = readRoutine(doc).annotations[0]?.id ?? "";
    // Start from a doc that already carries m1, so the two concurrent edits are
    // (left) tombstone m1 and (right) attach a second live item m2.
    const seeded = attachMedia(doc, annId, img("m1"));
    const left = softDeleteMedia(seeded, annId, "m1");
    const right = await applyMutations(seeded, [
      (d) => {
        const a = d.annotations.find((x) => x.id === annId);
        if (a?.media) a.media.push(img("m2"));
      },
    ]);
    const { converged } = await exchangeAndAssertConverged(left, right);
    const ann = readRoutine(converged, { includeDeleted: true }).annotations[0];
    const m1 = ann?.media?.find((m) => m.id === "m1");
    const m2 = ann?.media?.find((m) => m.id === "m2");
    expect(m1?.deletedAt).toEqual(expect.any(Number));
    expect(m2?.deletedAt == null).toBe(true);
  });

  it("soft-deletes only (no hard removal), and tombstoned media is readable via includeDeleted", () => {
    const doc = withAnnotation();
    const annId = readRoutine(doc).annotations[0]?.id ?? "";
    const gone = softDeleteMedia(attachMedia(doc, annId, img("m1")), annId, "m1");
    const ann = readRoutine(gone, { includeDeleted: true }).annotations[0];
    expect(ann?.media?.[0]?.deletedAt).toEqual(expect.any(Number));
  });
});
