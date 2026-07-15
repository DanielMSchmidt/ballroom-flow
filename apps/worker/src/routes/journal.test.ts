import { env, SELF } from "cloudflare:test";
import { zJournalList } from "@weavesteps/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { generateTestKeypair, makeTestJWT, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// T6 — GET /api/journal (PLAN §2.6/§2.7/§4.6). The cross-routine Journal read:
// the UNION of routine-scoped lesson/practice annotations (projected to
// journal_entry by the routine DO alarm) and account-scoped figureType
// lesson/practice notes (figure_type_note_index). Visibility = the user PLUS
// their co-members on shared routines, for BOTH arms (T6 LOCKED).
//
// Runs in real workerd (D1 + per-document DO + the fail-closed auth boundary).
// ─────────────────────────────────────────────────────────────────────────

const docs = env.DOC_DO;

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * WEP-0002 phase 3: POST /api/account/family-notes authors into the user's
 * account DO; its alarm is the single writer of the `figure_type_note_index`
 * projection the account arm of the journal reads. Drive that alarm so the
 * projected row is visible synchronously.
 */
async function runAccountAlarm(userId: string): Promise<void> {
  await docs.get(docs.idFromName(`account:${userId}`)).runAlarmForTest();
}

/** Seed a routine + figure, then drive its DO to add a lesson, a practice, and a
 *  plain note; run the alarm so the journal index is populated. Returns the doc id. */
async function seedRoutineWithEntries(opts: {
  routineRef: string;
  ownerId: string;
  figureRef: string;
}): Promise<void> {
  await seedDb({
    docs: [
      {
        docRef: opts.figureRef,
        type: "global-figure",
        ownerId: "app",
        doName: opts.figureRef,
        title: "Natural Turn",
        figureType: "natural_turn",
        dance: "waltz",
      },
    ],
  });
  const stub = docs.get(docs.idFromName(opts.routineRef));
  await stub.setMetadata({
    doName: opts.routineRef,
    docRef: opts.routineRef,
    type: "routine",
    ownerId: opts.ownerId,
    dance: "waltz",
    title: "Gold Waltz",
  });
  await stub.applyChange({
    op: "addAnnotation",
    kind: "lesson",
    authorId: opts.ownerId,
    text: "heads stay left through the natural turn",
    anchors: [{ type: "point", figureRef: opts.figureRef, count: 1 }],
  });
  await stub.applyChange({
    op: "addAnnotation",
    kind: "practice",
    authorId: opts.ownerId,
    text: "ran the routine full 5x",
    anchors: [],
  });
  await stub.applyChange({
    op: "addAnnotation",
    kind: "note",
    authorId: opts.ownerId,
    text: "this is a structural note, NOT a journal entry",
    anchors: [{ type: "figure", figureRef: opts.figureRef }],
  });
  await stub.runAlarmForTest();
}

describe("T6 GET /api/journal", () => {
  it("returns the owner's routine lesson+practice entries (note excluded), newest-first, author-coloured", async () => {
    const routineRef = "rt_journal_owner";
    await seedDb({
      users: [{ id: "owner1", displayName: "Anna", identityColor: "#1f8a5b", plan: "free" }],
      docs: [
        {
          docRef: routineRef,
          type: "routine",
          ownerId: "owner1",
          doName: routineRef,
          dance: "waltz",
        },
      ],
      memberships: [{ id: "m_owner1", docRef: routineRef, userId: "owner1", role: "editor" }],
    });
    await seedRoutineWithEntries({ routineRef, ownerId: "owner1", figureRef: "fig_nt_owner" });

    const token = await makeTestJWT(kp, { sub: "owner1" });
    const res = await SELF.fetch("https://x/api/journal", { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    const body = zJournalList.parse(await res.json());
    const kinds: string[] = body.entries.map((e) => e.kind);
    expect(kinds).toContain("lesson");
    expect(kinds).toContain("practice");
    expect(kinds).not.toContain("note"); // a plain note is NOT a journal entry
    // Newest-first.
    const times = body.entries.map((e) => e.createdAt);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // Author colour + a resolved point-anchor label (no client refetch, T6 §3).
    const lesson = body.entries.find((e) => e.kind === "lesson");
    expect(lesson?.displayName).toBe("Anna");
    expect(lesson?.identityColor).toBe("#1f8a5b");
    expect(lesson?.anchors[0]?.label).toBe("Natural Turn · step 2");
  });

  it("resolves a CATALOG live-reference anchor label from the bundled catalog (no registry row, ⟳v5)", async () => {
    // Regression (fast-gate journal journey, 2026-07-02): under v5 a notated
    // catalog figure's placement points at `global:<dance>:<figureType>` — which
    // has NO document_registry row until the admin seeder runs. The journal
    // projection must still resolve the chip label ("↳ Natural Turn") from the
    // bundled catalog, exactly like the client's own fallback.
    const routineRef = "rt_journal_cat";
    await seedDb({
      users: [{ id: "owner_cat", displayName: "Ava", identityColor: "#1f8a5b", plan: "free" }],
      docs: [
        {
          docRef: routineRef,
          type: "routine",
          ownerId: "owner_cat",
          doName: routineRef,
          dance: "waltz",
        },
      ],
      memberships: [{ id: "m_owner_cat", docRef: routineRef, userId: "owner_cat", role: "editor" }],
    });
    const stub = docs.get(docs.idFromName(routineRef));
    await stub.setMetadata({
      doName: routineRef,
      docRef: routineRef,
      type: "routine",
      ownerId: "owner_cat",
      dance: "waltz",
      title: "Bronze Waltz",
    });
    // Anchor the lesson to the CATALOG ref — deliberately NO registry row for it.
    await stub.applyChange({
      op: "addAnnotation",
      kind: "lesson",
      authorId: "owner_cat",
      text: "rise later through 2-3",
      anchors: [{ type: "figure", figureRef: "global:waltz:natural-turn" }],
    });
    await stub.runAlarmForTest();

    const token = await makeTestJWT(kp, { sub: "owner_cat" });
    const res = await SELF.fetch("https://x/api/journal", { headers: authHeaders(token) });
    expect(res.status).toBe(200);
    const body = zJournalList.parse(await res.json());
    const lesson = body.entries.find((e) => e.text === "rise later through 2-3");
    expect(lesson?.anchors[0]?.label).toBe("Natural Turn"); // from the bundle, not D1
  });

  it("co-membership gate: a member sees the routine's entries; a non-member sees none", async () => {
    const routineRef = "rt_journal_shared";
    await seedDb({
      users: [
        { id: "coach2", displayName: "Coach", identityColor: "#c0563f", plan: "free" },
        { id: "student2", displayName: "Student", identityColor: "#1f8a5b", plan: "free" },
        { id: "stranger2", displayName: "Stranger", identityColor: "#5b6b8a", plan: "free" },
      ],
      docs: [
        {
          docRef: routineRef,
          type: "routine",
          ownerId: "coach2",
          doName: routineRef,
          dance: "waltz",
        },
      ],
      memberships: [
        { id: "m_coach2", docRef: routineRef, userId: "coach2", role: "editor" },
        { id: "m_student2", docRef: routineRef, userId: "student2", role: "commenter" },
      ],
    });
    await seedRoutineWithEntries({ routineRef, ownerId: "coach2", figureRef: "fig_nt_shared" });

    // The co-member (student) sees the coach's entries (author-coloured cards).
    const studentTok = await makeTestJWT(kp, { sub: "student2" });
    const asStudent = await SELF.fetch("https://x/api/journal", {
      headers: authHeaders(studentTok),
    });
    const studentBody = zJournalList.parse(await asStudent.json());
    expect(
      studentBody.entries.some((e) => e.routineRef === routineRef && e.authorId === "coach2"),
    ).toBe(true);

    // A non-member sees NONE of that routine's entries (the gate holds).
    const strangerTok = await makeTestJWT(kp, { sub: "stranger2" });
    const asStranger = await SELF.fetch("https://x/api/journal", {
      headers: authHeaders(strangerTok),
    });
    const strangerBody = zJournalList.parse(await asStranger.json());
    expect(strangerBody.entries.some((e) => e.routineRef === routineRef)).toBe(false);
  });

  it("soft-delete: a tombstoned annotation drops from the list after re-projection", async () => {
    const routineRef = "rt_journal_delete";
    await seedDb({
      users: [{ id: "owner3", displayName: "Del", identityColor: "#333", plan: "free" }],
      docs: [
        {
          docRef: routineRef,
          type: "routine",
          ownerId: "owner3",
          doName: routineRef,
          dance: "waltz",
        },
      ],
    });
    const stub = docs.get(docs.idFromName(routineRef));
    await stub.setMetadata({
      doName: routineRef,
      docRef: routineRef,
      type: "routine",
      ownerId: "owner3",
      dance: "waltz",
    });
    await stub.applyChange({
      op: "addAnnotation",
      kind: "lesson",
      authorId: "owner3",
      text: "to be deleted",
      anchors: [],
    });
    await stub.runAlarmForTest();

    const token = await makeTestJWT(kp, { sub: "owner3" });
    const before = zJournalList.parse(
      await (await SELF.fetch("https://x/api/journal", { headers: authHeaders(token) })).json(),
    );
    const entry = before.entries.find((e) => e.text === "to be deleted");
    expect(entry).toBeDefined();

    // Soft-delete the annotation in the doc, re-project.
    if (entry) await stub.applyChange({ op: "deleteAnnotation", id: entry.id });
    await stub.runAlarmForTest();

    const after = zJournalList.parse(
      await (await SELF.fetch("https://x/api/journal", { headers: authHeaders(token) })).json(),
    );
    expect(after.entries.some((e) => e.text === "to be deleted")).toBe(false);
  });

  it("UNION: an account figureType lesson appears alongside the routine entries", async () => {
    const routineRef = "rt_journal_union";
    await seedDb({
      users: [{ id: "owner4", displayName: "Uni", identityColor: "#abc", plan: "free" }],
      docs: [
        {
          docRef: routineRef,
          type: "routine",
          ownerId: "owner4",
          doName: routineRef,
          dance: "waltz",
        },
      ],
      memberships: [{ id: "m_owner4", docRef: routineRef, userId: "owner4", role: "editor" }],
    });
    await seedRoutineWithEntries({ routineRef, ownerId: "owner4", figureRef: "fig_nt_union" });

    const token = await makeTestJWT(kp, { sub: "owner4" });
    // Author an account-scoped figureType LESSON via the existing route.
    const created = await SELF.fetch("https://x/api/account/family-notes", {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({
        kind: "lesson",
        text: "whisk more cross less turn",
        figureType: "whisk",
        danceScope: "waltz",
      }),
    });
    expect(created.status).toBe(201);
    // owner4's account-doc alarm projects the family note into figure_type_note_index.
    await runAccountAlarm("owner4");

    const res = await SELF.fetch("https://x/api/journal", { headers: authHeaders(token) });
    const body = zJournalList.parse(await res.json());
    const accountEntry = body.entries.find((e) => e.text === "whisk more cross less turn");
    expect(accountEntry?.source).toBe("account");
    expect(accountEntry?.anchors[0]?.label).toContain("Whisk");
    // The routine entries are still present alongside it.
    expect(body.entries.some((e) => e.source === "routine")).toBe(true);
  });

  it("account arm: a co-member's figureType lesson surfaces ONLY for a family present in a shared routine (family-note model)", async () => {
    const routineRef = "rt_acct_shared";
    await seedDb({
      users: [
        { id: "coach5", displayName: "Coach5", identityColor: "#c0563f", plan: "free" },
        { id: "student5", displayName: "Student5", identityColor: "#1f8a5b", plan: "free" },
      ],
      docs: [
        {
          docRef: routineRef,
          type: "routine",
          ownerId: "coach5",
          doName: routineRef,
          dance: "waltz",
        },
        // A Whisk figure the shared routine references (registry row + placement edge);
        // its figureType is what the family-note join matches against.
        {
          docRef: "fig_whisk5",
          type: "global-figure",
          ownerId: "app",
          doName: "fig_whisk5",
          title: "Whisk",
          dance: "waltz",
          figureType: "whisk5",
        },
      ],
      memberships: [
        { id: "m_coach5", docRef: routineRef, userId: "coach5", role: "editor" },
        { id: "m_student5", docRef: routineRef, userId: "student5", role: "commenter" },
      ],
      placementEdges: [{ routineRef, figureRef: "fig_whisk5" }],
    });

    const coachTok = await makeTestJWT(kp, { sub: "coach5" });
    // (i) a figureType lesson for a family PRESENT in the shared routine → visible to the student.
    await SELF.fetch("https://x/api/account/family-notes", {
      method: "POST",
      headers: { ...authHeaders(coachTok), "content-type": "application/json" },
      body: JSON.stringify({
        kind: "lesson",
        text: "whisk5 cross more",
        figureType: "whisk5",
        danceScope: "waltz",
      }),
    });
    // (ii) a figureType lesson for a family that appears in NO shared routine → hidden from the student.
    await SELF.fetch("https://x/api/account/family-notes", {
      method: "POST",
      headers: { ...authHeaders(coachTok), "content-type": "application/json" },
      body: JSON.stringify({
        kind: "lesson",
        text: "absent5 note",
        figureType: "absent5",
        danceScope: "all",
      }),
    });
    // Both notes are coach5's — one account-doc alarm projects both rows.
    await runAccountAlarm("coach5");

    const studentTok = await makeTestJWT(kp, { sub: "student5" });
    const res = await SELF.fetch("https://x/api/journal", { headers: authHeaders(studentTok) });
    const body = zJournalList.parse(await res.json());
    expect(body.entries.some((e) => e.text === "whisk5 cross more")).toBe(true); // family present in shared routine
    expect(body.entries.some((e) => e.text === "absent5 note")).toBe(false); // family absent → not surfaced
  });

  it("requires auth (401 with no token)", async () => {
    const res = await SELF.fetch("https://x/api/journal");
    expect(res.status).toBe(401);
  });
});
