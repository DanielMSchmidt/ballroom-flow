import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "./test-support/authed-context";
import { expectIndexedQuery } from "./test-support/explain";
import { generateTestKeypair, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-041 — Co-member visibility of family notes (option 2) [M6, system]
// docs/concepts/annotations.md § Anchors / § Ownership & visibility;
// docs/system/architecture.md § D1 — the index & projections;
// docs/concepts/collaboration.md § Roles; Q-FIGNOTE-VIS option 2; docs/system/testing.md:
// a figureType note is
// OWNED in the author's account doc but VISIBLE to co-members of a shared
// routine where the figure appears — via the FigureTypeNoteIndex + a
// co-membership gate. A NON-member sees NONE. A viewer never browses another
// account doc wholesale.
//
// The cross-account read path + FigureTypeNoteIndex are M6 product code →
// skipped. This is the scoped cross-account read, so it lives at the worker
// layer (D1 index + authorization), not pure domain.
// ─────────────────────────────────────────────────────────────────────────

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

/**
 * WEP-0002 phase 3 (docs/system/architecture.md § D1 — the index & projections):
 * POST /api/account/family-notes now authors the note in the
 * author's account DO; the DO alarm is the single writer of the
 * `figure_type_note_index` projection the co-member GET reads. Drive that alarm
 * (for the AUTHOR's account doc) so the projected row is visible synchronously —
 * the co-member visibility guarantee still holds end to end (author writes →
 * alarm projects → co-member reads).
 */
async function runAccountAlarm(userId: string): Promise<void> {
  const stub = env.DOC_DO.get(env.DOC_DO.idFromName(`account:${userId}`));
  await stub.runAlarmForTest();
}

/** Seed: coach authors a "feather/all" family note; coach+student co-own a
 *  Foxtrot routine referencing a Feather; stranger is NOT a member.
 *  Seeds ONCE — D1 is shared across the run (isolatedStorage:false), so the
 *  fixed doNames would collide if each test re-seeded them. */
let scenarioSeeded = false;
async function seedCoMembershipScenario() {
  if (scenarioSeeded) return;
  scenarioSeeded = true;
  await seedDb({
    users: [
      { id: "coach", displayName: "Coach", identityColor: "#c0563f", plan: "free" },
      { id: "student", displayName: "Student", identityColor: "#1f8a5b", plan: "free" },
      { id: "stranger", displayName: "Stranger", identityColor: "#5b6b8a", plan: "free" },
    ],
    docs: [
      { docRef: "rt", type: "routine", ownerId: "coach", doName: "rt", dance: "foxtrot" },
      {
        docRef: "ff",
        type: "global-figure",
        ownerId: "app",
        doName: "ff",
        figureType: "feather",
        dance: "foxtrot",
      },
      { docRef: "acct_coach", type: "account", ownerId: "coach", doName: "acct_coach" },
    ],
    memberships: [
      { id: "m_coach", docRef: "rt", userId: "coach", role: "editor" },
      { id: "m_student", docRef: "rt", userId: "student", role: "commenter" },
    ],
    // The thin FigureTypeNoteIndex row {accountDocRef, authorId, figureType,
    // danceScope} = {acct_coach, coach, feather, all}. The note CONTENT stays in
    // the coach's account doc; only this projection is queried cross-account.
    familyNotes: [
      {
        noteId: "n_feather",
        accountDocRef: "acct_coach",
        authorId: "coach",
        figureType: "feather",
        danceScope: "all",
      },
    ],
  });
}

describe("US-041 Co-member visibility of family notes (option 2)", () => {
  it("surfaces a co-member's family note on a shared routine's matching figure", async () => {
    // Intent: the student (a co-member) sees the coach's "every Feather" note on the
    //   Feather in their shared routine.
    // Multi-user scenario: coach authors the note; student opens routine R.
    // Arrange: seedCoMembershipScenario. Act: GET /api/routines/rt/family-notes as
    //   the STUDENT. Assert: 200 including the coach's feather/all note.
    // Covers US-041 AC-1 (index query surfaces members' matching notes) + AC-2
    //   (co-membership authorizes the scoped read).
    await seedCoMembershipScenario();
    const student = await authedContext({
      keypair: kp,
      userId: "student",
      docRef: "rt",
      role: "commenter",
    });
    const res = await SELF.fetch("https://x/api/routines/rt/family-notes", {
      headers: student.authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ notes: Array<{ authorId: string; figureType: string }> }>();
    expect(body.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authorId: "coach", figureType: "feather" }),
      ]),
    );
  });

  it("shows a NON-member NONE of those family notes (gate holds)", async () => {
    // Intent: a stranger (not a member of R) must not see the coach's family notes.
    // Multi-user scenario: stranger requests R's family notes.
    // Arrange: seedCoMembershipScenario (stranger has no membership). Act: GET the
    //   same endpoint as the STRANGER. Assert: 403 (not a member) — they never reach
    //   the cross-account content.
    // Covers US-041 AC-3 (non-member sees none) + AC-4 (no wholesale account browse).
    await seedCoMembershipScenario();
    const stranger = await authedContext({
      keypair: kp,
      userId: "stranger",
      docRef: "rt",
      role: null,
    });
    const res = await SELF.fetch("https://x/api/routines/rt/family-notes", {
      headers: stranger.authHeaders(),
    });
    expect(res.status).toBe(403);
  });

  it("a member can author a family note (POST) and read it back with content (GET)", async () => {
    // Intent: the create path (US-040) round-trips — author a family note, then
    //   discover it (with its content) via the co-member read on a routine the
    //   author belongs to. Proves the feature works end-to-end at the worker.
    const docRef = "rt_authored";
    await seedDb({
      users: [{ id: "author1", displayName: "A", identityColor: "#111", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "author1", doName: docRef, dance: "waltz" }],
      memberships: [{ id: "m_a1", docRef, userId: "author1", role: "editor" }],
    });
    const ctx = await authedContext({ keypair: kp, userId: "author1", docRef, role: "editor" });
    const created = await SELF.fetch("https://x/api/account/family-notes", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        kind: "lesson",
        text: "rise later",
        figureType: "natural_turn",
        danceScope: "all",
      }),
    });
    expect(created.status).toBe(201);
    // The note lives in author1's account doc; its alarm projects figure_type_note_index.
    await runAccountAlarm("author1");

    const got = await SELF.fetch(`https://x/api/routines/${docRef}/family-notes`, {
      headers: ctx.authHeaders(),
    });
    expect(got.status).toBe(200);
    const body = await got.json<{
      notes: Array<{ figureType: string; text: string; kind: string }>;
    }>();
    expect(body.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ figureType: "natural_turn", text: "rise later", kind: "lesson" }),
      ]),
    );
  });

  it("surfaces the routine OWNER's own family note on their own routine (no membership row, #168)", async () => {
    // Intent: a routine owner authors a "every <family>, all dances" note, then opens
    //   their own routine and sees it on the matching figure. Regression for the bug
    //   where a figureType note never surfaced on the choreos using that figure because
    //   the owner has NO membership row (they're elevated by resolveEffectiveRole), so
    //   the family-note author set (members(R)) excluded them.
    // Arrange: a SOLO routine — owner in document_registry.ownerId, NO membership row,
    //   NO co-members. Act: author a note (POST), read it back (GET) as the owner.
    // Assert: the note surfaces (would be absent before the owner arm was added).
    const docRef = "rt_solo_owner";
    await seedDb({
      users: [{ id: "solo_owner", displayName: "Solo", identityColor: "#222", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "solo_owner", doName: docRef, dance: "waltz" }],
      // Deliberately NO memberships — the owner relies on resolveEffectiveRole (#168).
    });
    // role: null → NO membership row; the owner is elevated by resolveEffectiveRole
    // from document_registry.ownerId (which seedDb set above) — the production path.
    const ctx = await authedContext({ keypair: kp, userId: "solo_owner", docRef, role: null });
    const created = await SELF.fetch("https://x/api/account/family-notes", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        kind: "lesson",
        text: "keep the head left",
        figureType: "natural_turn",
        danceScope: "all",
      }),
    });
    expect(created.status).toBe(201);
    await runAccountAlarm("solo_owner");

    const got = await SELF.fetch(`https://x/api/routines/${docRef}/family-notes`, {
      headers: ctx.authHeaders(),
    });
    expect(got.status).toBe(200);
    const body = await got.json<{
      notes: Array<{ figureType: string; text: string; authorId: string }>;
    }>();
    expect(body.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          figureType: "natural_turn",
          text: "keep the head left",
          authorId: "solo_owner",
        }),
      ]),
    );
  });

  it("round-trips a TIMED family note (count + role) and rejects 'all'-scope timing (WEP-0004)", async () => {
    // Intent: the rushed Whisk — "count 3 of every Whisk in my Waltz choreos"
    //   persists count/role (migration 0018 columns) and the co-member read
    //   returns them on the note AND its figureType anchor, so the client can
    //   pin the note in the grid. The invariant (no cross-dance timing) is
    //   enforced at the REST boundary: danceScope "all" + count → 400.
    const docRef = "rt_timed_note";
    await seedDb({
      users: [{ id: "timed_author", displayName: "T", identityColor: "#333", plan: "free" }],
      docs: [{ docRef, type: "routine", ownerId: "timed_author", doName: docRef, dance: "waltz" }],
      memberships: [{ id: "m_t1", docRef, userId: "timed_author", role: "editor" }],
    });
    const ctx = await authedContext({
      keypair: kp,
      userId: "timed_author",
      docRef,
      role: "editor",
    });
    const created = await SELF.fetch("https://x/api/account/family-notes", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        kind: "practice",
        text: "settle before the chassé",
        figureType: "whisk",
        danceScope: "waltz",
        count: 3,
        role: "leader",
      }),
    });
    expect(created.status).toBe(201);
    await runAccountAlarm("timed_author");

    const got = await SELF.fetch(`https://x/api/routines/${docRef}/family-notes`, {
      headers: ctx.authHeaders(),
    });
    expect(got.status).toBe(200);
    const body = await got.json<{
      notes: Array<{
        figureType: string;
        count?: number | null;
        role?: string | null;
        anchors: Array<Record<string, unknown>>;
      }>;
    }>();
    const note = body.notes.find((n) => n.figureType === "whisk");
    expect(note).toBeDefined();
    expect(note?.count).toBe(3);
    expect(note?.role).toBe("leader");
    expect(note?.anchors[0]).toMatchObject({
      type: "figureType",
      figureType: "whisk",
      danceScope: "waltz",
      count: 3,
      role: "leader",
    });

    // The boundary invariant: a timed note cannot span all dances.
    const rejected = await SELF.fetch("https://x/api/account/family-notes", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        kind: "practice",
        text: "x",
        figureType: "whisk",
        danceScope: "all",
        count: 3,
      }),
    });
    expect(rejected.status).toBe(400);
  });

  it("uses an INDEX for the FigureTypeNoteIndex lookup (EXPLAIN, no SCAN)", async () => {
    // Intent: the co-member family-note discovery query is indexed (NFR).
    // Arrange: the EXACT SQL the route runs — familyNotesForMembers filters by
    //   `authorId IN (members(R))` + dance scope (NOT by figureType; the client
    //   matches families post-hoc via resolveFamilyNotesFor). The test must mirror
    //   the runtime query, or it proves an index for a path the code never takes.
    // Act: expectIndexedQuery. Assert: no SCAN (uses idx_ftni_author on authorId).
    // Covers the §10.2 EXPLAIN coverage for this cross-account read path.
    await expectIndexedQuery(
      env.DB,
      "SELECT noteId, accountDocRef, authorId, figureType, danceScope, kind, text FROM figure_type_note_index WHERE deletedAt IS NULL AND (danceScope = ? OR danceScope = 'all') AND authorId IN (?, ?)",
      ["foxtrot", "coach", "student"],
    );
  });
});
