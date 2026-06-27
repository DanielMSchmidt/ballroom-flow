import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "./test-support/authed-context";
import { expectIndexedQuery } from "./test-support/explain";
import { generateTestKeypair, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-041 — Co-member visibility of family notes (option 2) [M6, system]
// PLAN §2.6, §2.7, §5.1, Q-FIGNOTE-VIS option 2, §10.2: a figureType note is
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
    const body = (await res.json()) as { notes: Array<{ authorId: string; figureType: string }> };
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

  it("uses an INDEX for the FigureTypeNoteIndex lookup (EXPLAIN, no SCAN)", async () => {
    // Intent: the co-member family-note discovery query is indexed (NFR).
    // Arrange: the lookup SQL (notes by members(R) matching the figures in R).
    // Act: expectIndexedQuery. Assert: no SCAN.
    // Covers the §10.2 EXPLAIN coverage for this cross-account read path.
    await expectIndexedQuery(
      env.DB,
      "SELECT accountDocRef, authorId, figureType, danceScope FROM figure_type_note_index WHERE figureType = ?1 AND (danceScope = ?2 OR danceScope = 'all') AND authorId IN (SELECT userId FROM membership WHERE docRef = ?3 AND deletedAt IS NULL)",
      ["feather", "foxtrot", "rt"],
    );
  });
});
