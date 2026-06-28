// US-040 — account doc (figure-family notes) + family-note resolution.
import { describe, expect, it } from "vitest";
import type { DanceId } from "./dances";
import {
  addFamilyNote,
  buildAccountDoc,
  readAccount,
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
