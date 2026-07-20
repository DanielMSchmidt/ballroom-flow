// attribute-predicate-anchors — Co-member visibility of predicate notes (HARD REVIEW GATE)
// docs/concepts/annotations.md § Anchors / § Ownership & visibility;
// docs/system/architecture.md § D1 — the index & projections;
// docs/concepts/collaboration.md § Roles.
//
// A predicate note is OWNED in the author's account doc but VISIBLE to co-members of a
// shared routine where a matching step appears — via attribute_predicate_note_index + a
// co-membership gate (mirrors the family-note gate exactly). A NON-member sees NONE (403,
// before any note is read). A 'routine'-scoped note NEVER comes back from this cross-account
// route. The read query is index-served (expectIndexedQuery — no SCAN).

import { env, SELF } from "cloudflare:test";
import type { DanceId } from "@weavesteps/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "./test-support/authed-context";
import { expectIndexedQuery } from "./test-support/explain";
import { generateTestKeypair, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

async function runAccountAlarm(userId: string): Promise<void> {
  const stub = env.DOC_DO.get(env.DOC_DO.idFromName(`account:${userId}`));
  await stub.runAlarmForTest();
}

async function ensureAndAuthor(
  userId: string,
  note: {
    kind: "note" | "lesson" | "practice";
    text: string;
    attrKind: string;
    attrValue: string;
    attrRole?: "leader" | "follower";
    scope: DanceId | "all" | "routine";
    routineRef?: string;
  },
): Promise<string> {
  const stub = env.DOC_DO.get(env.DOC_DO.idFromName(`account:${userId}`));
  const { ensureAccountDoc } = await import("./ensure-account-doc");
  await ensureAccountDoc(env, userId);
  const { id } = await stub.applyAccountEdit({
    op: "addPredicateNote",
    authorId: userId,
    kind: note.kind,
    text: note.text,
    attrKind: note.attrKind,
    attrValue: note.attrValue,
    scope: note.scope,
    ...(note.attrRole ? { attrRole: note.attrRole } : {}),
    ...(note.routineRef ? { routineRef: note.routineRef } : {}),
  });
  await runAccountAlarm(userId);
  return id ?? "";
}

// Seed ONCE — D1 is shared across the run (isolatedStorage:false), fixed doNames collide.
let seeded = false;
async function seedScenario() {
  if (seeded) return;
  seeded = true;
  await seedDb({
    users: [
      { id: "pcoach", displayName: "Coach", identityColor: "#c0563f", plan: "free" },
      { id: "pstudent", displayName: "Student", identityColor: "#1f8a5b", plan: "free" },
      { id: "pstranger", displayName: "Stranger", identityColor: "#5b6b8a", plan: "free" },
    ],
    docs: [{ docRef: "prt", type: "routine", ownerId: "pcoach", doName: "prt", dance: "waltz" }],
    memberships: [
      { id: "pm_coach", docRef: "prt", userId: "pcoach", role: "editor" },
      { id: "pm_student", docRef: "prt", userId: "pstudent", role: "commenter" },
    ],
  });
  // Coach authors a dance-scoped predicate note, an 'all'-scoped one, a mismatched-dance
  // one, and a routine-scoped one.
  await ensureAndAuthor("pcoach", {
    kind: "note",
    text: "soften every left sway",
    attrKind: "sway",
    attrValue: "left",
    scope: "waltz",
  });
  await ensureAndAuthor("pcoach", {
    kind: "note",
    text: "rise everywhere",
    attrKind: "rise",
    attrValue: "none",
    scope: "all",
  });
  await ensureAndAuthor("pcoach", {
    kind: "note",
    text: "foxtrot only",
    attrKind: "sway",
    attrValue: "right",
    scope: "foxtrot",
  });
  await ensureAndAuthor("pcoach", {
    kind: "note",
    text: "just this choreo",
    attrKind: "sway",
    attrValue: "left",
    scope: "routine",
    routineRef: "prt",
  });
}

describe("attribute-predicate notes — co-member visibility (HARD GATE)", () => {
  it("a co-member GETs 200 with the coach's dance-scoped + all-scoped notes (full content + anchor)", async () => {
    await seedScenario();
    const student = await authedContext({
      keypair: kp,
      userId: "pstudent",
      docRef: "prt",
      role: "commenter",
    });
    const res = await SELF.fetch("https://x/api/routines/prt/predicate-notes", {
      headers: student.authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{
      notes: Array<{
        authorId: string;
        text: string;
        anchors: Array<{ type: string; kind: string; value: string; scope: string }>;
      }>;
    }>();
    const texts = body.notes.map((n) => n.text);
    expect(texts).toContain("soften every left sway");
    expect(texts).toContain("rise everywhere");
    // full anchor shape on the dance-scoped note
    const sway = body.notes.find((n) => n.text === "soften every left sway");
    expect(sway?.anchors[0]).toMatchObject({
      type: "attributePredicate",
      kind: "sway",
      value: "left",
      scope: "waltz",
    });
  });

  it("the author sees their own note on their own routine (owner-elevation arm)", async () => {
    await seedScenario();
    const coach = await authedContext({
      keypair: kp,
      userId: "pcoach",
      docRef: "prt",
      role: "editor",
    });
    const res = await SELF.fetch("https://x/api/routines/prt/predicate-notes", {
      headers: coach.authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ notes: Array<{ text: string }> }>();
    expect(body.notes.map((n) => n.text)).toContain("soften every left sway");
  });

  it("a NON-member gets 403 with zero rows read", async () => {
    await seedScenario();
    const stranger = await authedContext({
      keypair: kp,
      userId: "pstranger",
      docRef: "prt",
      role: null,
    });
    const res = await SELF.fetch("https://x/api/routines/prt/predicate-notes", {
      headers: stranger.authHeaders(),
    });
    expect(res.status).toBe(403);
  });

  it("a mismatched-dance note is absent; a 'routine'-scoped note NEVER comes back", async () => {
    await seedScenario();
    const student = await authedContext({
      keypair: kp,
      userId: "pstudent",
      docRef: "prt",
      role: "commenter",
    });
    const res = await SELF.fetch("https://x/api/routines/prt/predicate-notes", {
      headers: student.authHeaders(),
    });
    const body = await res.json<{ notes: Array<{ text: string }> }>();
    const texts = body.notes.map((n) => n.text);
    expect(texts).not.toContain("foxtrot only");
    expect(texts).not.toContain("just this choreo");
  });

  it("an unauthenticated request is 401", async () => {
    await seedScenario();
    const res = await SELF.fetch("https://x/api/routines/prt/predicate-notes");
    expect(res.status).toBe(401);
  });

  it("keeps the co-member read query indexed (EXPLAIN, no SCAN)", async () => {
    // Mirror the EXACT runtime SQL of predicateNotesForMembers — one author placeholder.
    await expectIndexedQuery(
      env.DB,
      "SELECT noteId, accountDocRef, authorId, attrKind, attrValue, attrRole, scope, kind, text, updatedAt FROM attribute_predicate_note_index WHERE deletedAt IS NULL AND (scope = ? OR scope = 'all') AND authorId IN (?)",
      ["waltz", "pcoach"],
    );
  });
});
