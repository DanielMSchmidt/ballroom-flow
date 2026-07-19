// attribute-predicate-anchors — the account-DO alarm projection of predicate notes to
// attribute_predicate_note_index (migration 0019). Modeled on figuretype-visibility.test.ts's
// account-alarm section + ensure-account-doc.test.ts's stub helper.
//
// INVARIANT: the alarm is the single writer; the projection is non-destructive, idempotent,
// and tombstone-aware (a soft-deleted note carries deletedAt, never disappears). Per-test
// unique user ids — D1 + DO storage are shared (isolatedStorage: false).
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureAccountDoc } from "./ensure-account-doc";
import { uniqueDocName } from "./test-support/do-id";
import { applyMigrations, seedDb } from "./test-support/seed";

beforeAll(async () => {
  await applyMigrations();
});

const accountStub = (userId: string) => env.DOC_DO.get(env.DOC_DO.idFromName(`account:${userId}`));

const predicateRow = (noteId: string) =>
  env.DB.prepare(
    "SELECT noteId, accountDocRef, authorId, attrKind, attrValue, attrRole, scope, kind, text, deletedAt FROM attribute_predicate_note_index WHERE noteId = ?1",
  )
    .bind(noteId)
    .first<{
      noteId: string;
      accountDocRef: string;
      authorId: string;
      attrKind: string;
      attrValue: string;
      attrRole: string | null;
      scope: string;
      kind: string;
      text: string;
      deletedAt: number | null;
    }>();

const rowCount = (noteId: string) =>
  env.DB.prepare("SELECT COUNT(*) AS n FROM attribute_predicate_note_index WHERE noteId = ?1")
    .bind(noteId)
    .first<{ n: number }>()
    .then((r) => r?.n ?? 0);

async function seedUser(userId: string): Promise<void> {
  await seedDb({
    users: [{ id: userId, displayName: "U", identityColor: "#123", plan: "free" }],
  });
  await ensureAccountDoc(env, userId);
}

describe("attribute_predicate_note_index — alarm projection", () => {
  it("projects a predicate note to the index with all columns (deletedAt NULL)", async () => {
    const userId = uniqueDocName("u_pred");
    await seedUser(userId);
    const stub = accountStub(userId);
    const { id } = await stub.applyAccountEdit({
      op: "addPredicateNote",
      authorId: userId,
      kind: "note",
      text: "soften",
      attrKind: "sway",
      attrValue: "left",
      attrRole: "leader",
      scope: "waltz",
    });
    expect(id).toBeTruthy();
    await stub.runAlarmForTest();

    const row = await predicateRow(id ?? "");
    expect(row).toMatchObject({
      noteId: id,
      accountDocRef: `account:${userId}`,
      authorId: userId,
      attrKind: "sway",
      attrValue: "left",
      attrRole: "leader",
      scope: "waltz",
      kind: "note",
      text: "soften",
      deletedAt: null,
    });
  });

  it("is idempotent + non-destructive: a second alarm keeps exactly one row", async () => {
    const userId = uniqueDocName("u_pred");
    await seedUser(userId);
    const stub = accountStub(userId);
    const { id } = await stub.applyAccountEdit({
      op: "addPredicateNote",
      authorId: userId,
      kind: "note",
      text: "again",
      attrKind: "rise",
      attrValue: "none",
      scope: "all",
    });
    await stub.runAlarmForTest();
    await stub.runAlarmForTest();
    expect(await rowCount(id ?? "")).toBe(1);
  });

  it("is tombstone-aware: deleting the note projects a deletedAt, never a disappearance", async () => {
    const userId = uniqueDocName("u_pred");
    await seedUser(userId);
    const stub = accountStub(userId);
    const { id } = await stub.applyAccountEdit({
      op: "addPredicateNote",
      authorId: userId,
      kind: "note",
      text: "delete me",
      attrKind: "sway",
      attrValue: "right",
      scope: "waltz",
    });
    await stub.runAlarmForTest();
    // deleteFamilyNote soft-deletes ANY account annotation (softDeleteAccountAnnotation).
    await stub.applyAccountEdit({ op: "deleteFamilyNote", annotationId: id ?? "" });
    await stub.runAlarmForTest();
    const row = await predicateRow(id ?? "");
    expect(row?.noteId).toBe(id);
    expect(row?.deletedAt).not.toBeNull();
  });

  it("projects a routine-scoped note with scope 'routine' (never served cross-account)", async () => {
    const userId = uniqueDocName("u_pred");
    await seedUser(userId);
    const stub = accountStub(userId);
    const { id } = await stub.applyAccountEdit({
      op: "addPredicateNote",
      authorId: userId,
      kind: "note",
      text: "just here",
      attrKind: "sway",
      attrValue: "left",
      scope: "routine",
      routineRef: "rt_x",
    });
    await stub.runAlarmForTest();
    const row = await predicateRow(id ?? "");
    expect(row?.scope).toBe("routine");
  });
});
