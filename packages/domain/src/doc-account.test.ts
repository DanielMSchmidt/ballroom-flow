// US-040 — account doc (figure-family notes) + family-note resolution.
import { describe, expect, it } from "vitest";
import type { DanceId } from "./dances";
import {
  addFamilyNote,
  addLibraryRef,
  buildAccountDoc,
  readAccount,
  removeLibraryRef,
  resolveFamilyNotesFor,
  softDeleteAccountAnnotation,
} from "./doc-account";
import type { AccountDoc, FigureDoc } from "./doc-types";

const acct = (): AccountDoc => ({
  id: "account:u1",
  ownerId: "u1",
  annotations: [],
  schemaVersion: 1,
});

const fig = (id: string, figureType: string, dance: DanceId): FigureDoc => ({
  id,
  scope: "account",
  ownerId: "u1",
  figureType,
  dance,
  name: figureType,
  source: "custom",
  attributes: [],
  schemaVersion: 1,
  deletedAt: null,
});

describe("account doc + family-note resolution", () => {
  it("US-043 readAccount defaults customKinds to [] for a doc without the field", () => {
    // Forward-compatible read: an account doc authored before custom kinds existed
    // (no `customKinds` field) must read back as an empty list, not undefined.
    const doc = buildAccountDoc(acct());
    expect(readAccount(doc).customKinds).toEqual([]);
  });

  it("adds an all-dances family note that matches the family in any dance", () => {
    let doc = buildAccountDoc(acct());
    doc = addFamilyNote(doc, {
      authorId: "u1",
      kind: "lesson",
      text: "head left",
      figureType: "feather",
      danceScope: "all",
    });
    const notes = readAccount(doc).annotations;
    const map = resolveFamilyNotesFor(
      [
        fig("a", "feather", "foxtrot"),
        fig("b", "feather", "waltz"),
        fig("c", "spin_turn", "waltz"),
      ],
      notes,
    );
    expect(map.get("a")?.[0]?.text).toBe("head left"); // foxtrot feather
    expect(map.get("b")?.[0]?.text).toBe("head left"); // waltz feather
    expect(map.get("c")).toBeUndefined(); // different family
  });

  it("a this-dance note matches only that dance", () => {
    let doc = buildAccountDoc(acct());
    doc = addFamilyNote(doc, {
      authorId: "u1",
      kind: "note",
      text: "x",
      figureType: "feather",
      danceScope: "foxtrot",
    });
    const map = resolveFamilyNotesFor(
      [fig("a", "feather", "foxtrot"), fig("b", "feather", "waltz")],
      readAccount(doc).annotations,
    );
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(false);
  });

  it("drops a tombstoned family note on read", () => {
    let doc = buildAccountDoc(acct());
    doc = addFamilyNote(doc, {
      authorId: "u1",
      kind: "note",
      text: "x",
      figureType: "feather",
      danceScope: "all",
    });
    const id = readAccount(doc).annotations[0]?.id ?? "";
    doc = softDeleteAccountAnnotation(doc, id);
    expect(readAccount(doc).annotations).toHaveLength(0);
  });
});

describe("library bookmarks (§2.2/§4.2/§5.2, ⟳v5) — a REFERENCE, never a copy", () => {
  it("readAccount defaults libraryFigureRefs to [] for a doc without the field", () => {
    // Lenient read: a pre-v5 account doc has no `libraryFigureRefs` at all.
    const doc = buildAccountDoc(acct());
    expect(readAccount(doc).libraryFigureRefs).toEqual([]);
  });

  it("addLibraryRef records the figureRef", () => {
    let doc = buildAccountDoc(acct());
    doc = addLibraryRef(doc, "fig_1");
    expect(readAccount(doc).libraryFigureRefs).toEqual(["fig_1"]);
  });

  it("addLibraryRef is idempotent — bookmarking the same ref twice doesn't duplicate", () => {
    let doc = buildAccountDoc(acct());
    doc = addLibraryRef(doc, "fig_1");
    doc = addLibraryRef(doc, "fig_1");
    expect(readAccount(doc).libraryFigureRefs).toEqual(["fig_1"]);
  });

  it("addLibraryRef accumulates distinct refs (several bookmarks)", () => {
    let doc = buildAccountDoc(acct());
    doc = addLibraryRef(doc, "fig_1");
    doc = addLibraryRef(doc, "global:waltz:natural-turn");
    expect(readAccount(doc).libraryFigureRefs).toEqual(["fig_1", "global:waltz:natural-turn"]);
  });

  it("removeLibraryRef un-bookmarks a figure without touching the others", () => {
    let doc = buildAccountDoc(acct());
    doc = addLibraryRef(doc, "fig_1");
    doc = addLibraryRef(doc, "fig_2");
    doc = removeLibraryRef(doc, "fig_1");
    expect(readAccount(doc).libraryFigureRefs).toEqual(["fig_2"]);
  });

  it("removeLibraryRef on an absent ref (or an empty set) is a no-op", () => {
    let doc = buildAccountDoc(acct());
    doc = removeLibraryRef(doc, "never_added"); // no libraryFigureRefs field yet
    expect(readAccount(doc).libraryFigureRefs).toEqual([]);
    doc = addLibraryRef(doc, "fig_1");
    doc = removeLibraryRef(doc, "not_this_one");
    expect(readAccount(doc).libraryFigureRefs).toEqual(["fig_1"]);
  });
});
