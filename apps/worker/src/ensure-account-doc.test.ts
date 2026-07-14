// WEP-0002 — ensureAccountDoc (lazy import) + the alarm projection inversion.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertFamilyNote } from "./db/family-notes";
import { bookmarkFigure } from "./db/library";
import { ensureAccountDoc } from "./ensure-account-doc";
import { uniqueDocName } from "./test-support/do-id";
import { expectIndexedQuery } from "./test-support/explain";
import { applyMigrations } from "./test-support/seed";

beforeAll(async () => {
  await applyMigrations();
});

const accountStub = (userId: string) => {
  const docRef = `account:${userId}`;
  return { docRef, stub: env.DOC_DO.get(env.DOC_DO.idFromName(docRef)) };
};

const liveLibrary = (userId: string) =>
  env.DB.prepare(
    "SELECT figureRef FROM library_entry WHERE userId = ?1 AND deletedAt IS NULL ORDER BY figureRef",
  )
    .bind(userId)
    .all<{ figureRef: string }>()
    .then((r) => (r.results ?? []).map((x) => x.figureRef));

const noteRow = (noteId: string) =>
  env.DB.prepare(
    "SELECT noteId, authorId, figureType, danceScope, kind, text, deletedAt FROM figure_type_note_index WHERE noteId = ?1",
  )
    .bind(noteId)
    .first<{
      noteId: string;
      authorId: string;
      figureType: string;
      danceScope: string;
      kind: string;
      text: string;
      deletedAt: number | null;
    }>();

describe("WEP-0002 ensureAccountDoc — lazy import from D1 rows", () => {
  it("mints the registry row + a seeded doc from the user's live D1 rows, reusing noteIds", async () => {
    const userId = uniqueDocName("u");
    const { docRef, stub } = accountStub(userId);
    await bookmarkFigure(env.DB, userId, "global:waltz:natural_turn");
    await insertFamilyNote(env.DB, {
      noteId: "note_import_1",
      authorId: userId,
      figureType: "feather",
      danceScope: "all",
      kind: "practice",
      text: "head left",
    });

    await ensureAccountDoc(env, userId);

    // Registry row now exists (owner-only), typed 'account'.
    const reg = await env.DB.prepare(
      "SELECT type, ownerId, doName FROM document_registry WHERE docRef = ?1",
    )
      .bind(docRef)
      .first<{ type: string; ownerId: string; doName: string }>();
    expect(reg).toEqual({ type: "account", ownerId: userId, doName: docRef });

    // The seeded doc carries the bookmark + the note (noteId REUSED as annotation id).
    const snap = await stub.getAccountSnapshot();
    expect(snap?.libraryFigureRefs).toEqual(["global:waltz:natural_turn"]);
    expect(snap?.annotations.map((a) => a.id)).toEqual(["note_import_1"]);
    expect(snap?.annotations[0]?.text).toBe("head left");
  });

  it("is idempotent and never re-imports over an existing doc (registry-row gate)", async () => {
    const userId = uniqueDocName("u");
    const { stub } = accountStub(userId);
    await bookmarkFigure(env.DB, userId, "fig_a");
    await ensureAccountDoc(env, userId);

    // Mutate the LIVE doc, then add a NEW D1 row that a naive re-import would pull in.
    await stub.applyAccountEdit({ op: "addLibraryRef", figureRef: "fig_live_only" });
    await bookmarkFigure(env.DB, userId, "fig_added_after");

    await ensureAccountDoc(env, userId); // second call — must be a no-op (row exists)

    const snap = await stub.getAccountSnapshot();
    // The doc kept its live edit and did NOT re-import the after-the-fact D1 row.
    expect(snap?.libraryFigureRefs).toContain("fig_live_only");
    expect(snap?.libraryFigureRefs).not.toContain("fig_added_after");
  });

  it("the import reads are index-backed (no table SCAN)", async () => {
    const userId = uniqueDocName("u");
    await expectIndexedQuery(
      env.DB,
      "SELECT figureRef FROM library_entry WHERE userId = ?1 AND deletedAt IS NULL",
      [userId],
    );
    await expectIndexedQuery(
      env.DB,
      "SELECT noteId, kind, text, figureType, danceScope, count, role, updatedAt FROM figure_type_note_index WHERE authorId = ?1 AND deletedAt IS NULL",
      [userId],
    );
  });
});

describe("WEP-0002 alarm projection — the doc is the source of truth, D1 the projection", () => {
  it("projects library + family-note edits to D1, tombstones both ways, and is idempotent", async () => {
    const userId = uniqueDocName("u");
    const { stub } = accountStub(userId);
    await ensureAccountDoc(env, userId); // empty doc + registry row

    // Author a bookmark + a family note through the doc, then project.
    await stub.applyAccountEdit({ op: "addLibraryRef", figureRef: "fig_a" });
    const { id } = await stub.applyAccountEdit({
      op: "addFamilyNote",
      authorId: userId,
      kind: "practice",
      text: "keep the head left",
      figureType: "feather",
      danceScope: "all",
    });
    if (!id) throw new Error("expected a created note id");
    await stub.runAlarmForTest();

    expect(await liveLibrary(userId)).toEqual(["fig_a"]);
    const projected = await noteRow(id);
    expect(projected).toMatchObject({
      authorId: userId,
      figureType: "feather",
      danceScope: "all",
      kind: "practice",
      text: "keep the head left",
      deletedAt: null,
    });

    // Idempotence: re-running the alarm on an unchanged doc leaves the same rows.
    await stub.runAlarmForTest();
    expect(await liveLibrary(userId)).toEqual(["fig_a"]);
    expect((await noteRow(id))?.deletedAt).toBeNull();

    // Remove the bookmark + delete the note → both tombstone in D1 after projection.
    await stub.applyAccountEdit({ op: "removeLibraryRef", figureRef: "fig_a" });
    await stub.applyAccountEdit({ op: "deleteFamilyNote", annotationId: id });
    await stub.runAlarmForTest();
    expect(await liveLibrary(userId)).toEqual([]); // ref left the set → tombstoned
    expect((await noteRow(id))?.deletedAt).not.toBeNull(); // note tombstoned, not removed
  });
});
