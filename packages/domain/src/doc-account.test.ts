// US-040 — account doc (figure-family notes) + family-note resolution.
import { describe, expect, it } from "vitest";
import type { DanceId } from "./dances";
import {
  type AccountImportRows,
  addFamilyNote,
  addLibraryRef,
  buildAccountDoc,
  importAccountDoc,
  readAccount,
  removeLibraryRef,
  resolveFamilyNotesFor,
  softDeleteAccountAnnotation,
} from "./doc-account";
import type { AccountDoc, FigureDoc } from "./doc-types";
import { CURRENT_SCHEMA_VERSION } from "./migrations";

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

describe("importAccountDoc (WEP-0002 — seed the live account DO from D1 rows)", () => {
  const rows = (over?: Partial<AccountImportRows>): AccountImportRows => ({
    userId: "u1",
    libraryFigureRefs: [],
    familyNotes: [],
    ...over,
  });

  it("builds an owner-stamped doc at account:<userId>, stamped CURRENT_SCHEMA_VERSION", () => {
    const doc = readAccount(buildAccountDoc(importAccountDoc(rows())));
    expect(doc.id).toBe("account:u1");
    expect(doc.ownerId).toBe("u1");
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.deletedAt ?? null).toBeNull();
    expect(doc.annotations).toEqual([]);
    expect(doc.libraryFigureRefs).toEqual([]);
  });

  it("reuses the D1 noteId as the annotation id so identities survive the inversion", () => {
    const doc = readAccount(
      buildAccountDoc(
        importAccountDoc(
          rows({
            familyNotes: [
              {
                noteId: "note_ULID_1",
                kind: "practice",
                text: "keep the head left on every Feather",
                figureType: "feather",
                danceScope: "all",
                createdAt: 1000,
              },
            ],
          }),
        ),
      ),
    );
    expect(doc.annotations).toHaveLength(1);
    const note = doc.annotations[0];
    expect(note?.id).toBe("note_ULID_1"); // REUSED, not freshly minted
    expect(note?.authorId).toBe("u1");
    expect(note?.kind).toBe("practice");
    expect(note?.text).toBe("keep the head left on every Feather");
    expect(note?.createdAt).toBe(1000); // from the row, not Date.now()
    expect(note?.replies).toEqual([]);
    expect(note?.anchors).toEqual([
      { type: "figureType", figureType: "feather", danceScope: "all" },
    ]);
  });

  it("carries the library bookmark set, deduped, in row order", () => {
    const doc = readAccount(
      buildAccountDoc(
        importAccountDoc(
          rows({ libraryFigureRefs: ["global:waltz:natural_turn", "fig_a", "fig_a"] }),
        ),
      ),
    );
    expect(doc.libraryFigureRefs).toEqual(["global:waltz:natural_turn", "fig_a"]);
  });

  it("is tombstone-safe: a deleted row imports as a tombstoned annotation (dropped by default read, surfaced with includeDeleted)", () => {
    const built = buildAccountDoc(
      importAccountDoc(
        rows({
          familyNotes: [
            {
              noteId: "note_live",
              kind: "practice",
              text: "live",
              figureType: "feather",
              danceScope: "all",
              createdAt: 1,
            },
            {
              noteId: "note_dead",
              kind: "practice",
              text: "deleted",
              figureType: "three_step",
              danceScope: "all",
              createdAt: 2,
              deletedAt: 5,
            },
          ],
        }),
      ),
    );
    expect(readAccount(built).annotations.map((a) => a.id)).toEqual(["note_live"]);
    const all = readAccount(built, { includeDeleted: true });
    expect(all.annotations.map((a) => a.id)).toEqual(["note_live", "note_dead"]);
    expect(all.annotations.find((a) => a.id === "note_dead")?.deletedAt).toBe(5);
  });

  it("is pure/deterministic: identical rows produce structurally identical docs (no Date.now / no ULID minting)", () => {
    const input = rows({
      libraryFigureRefs: ["fig_a"],
      familyNotes: [
        {
          noteId: "n1",
          kind: "lesson",
          text: "t",
          figureType: "feather",
          danceScope: "waltz",
          createdAt: 7,
        },
      ],
    });
    expect(importAccountDoc(input)).toEqual(importAccountDoc(input));
  });

  it("round-trips through the mutators: the imported doc accepts a further addFamilyNote/addLibraryRef", () => {
    let doc = buildAccountDoc(importAccountDoc(rows({ libraryFigureRefs: ["fig_a"] })));
    doc = addLibraryRef(doc, "fig_b");
    doc = addFamilyNote(doc, {
      authorId: "u1",
      kind: "practice",
      text: "new one",
      figureType: "feather",
      danceScope: "all",
    });
    const read = readAccount(doc);
    expect(read.libraryFigureRefs).toEqual(["fig_a", "fig_b"]);
    expect(read.annotations).toHaveLength(1);
  });
});
