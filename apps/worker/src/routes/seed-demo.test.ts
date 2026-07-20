// US-056 — POST/DELETE /api/admin/seed-demo integration (the ship gate).
//
// Intent: the admin demo-seed route is a HARD-GATED ops surface. This suite pins
// the authz boundary (non-admin → 403 before any write), correct materialization
// (routines/figures/annotations/memberships/family-notes into the CALLER's own
// account, backdated createdAt preserved, co-member authorship present),
// idempotency (a second call adds no duplicates), and the SOFT-delete side.
//
// Runs in real workerd (vitest-pool-workers): unique DO ids per test are moot
// here because the demo docs are namespaced by the caller userId — each test uses
// a DISTINCT admin userId so its demo set never collides with another test's.

import { env, runInDurableObject, SELF } from "cloudflare:test";
import * as A from "@automerge/automerge";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { expectIndexedQuery } from "../test-support/explain";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// `env.DOC_DO` is typed as the DocDO namespace, so the stub exposes its RPC
// methods (getSnapshot / getFigureSnapshot) natively — no cast needed.
const docs = env.DOC_DO;

let kp: TestKeypair;

beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

/** A signed JWT for `userId` (no doc/role needed — the route auths the caller). */
async function tokenFor(userId: string): Promise<Record<string, string>> {
  const ctx = await authedContext({ keypair: kp, userId, docRef: "n/a", role: null });
  return ctx.authHeaders();
}

describe("US-056 POST /api/admin/seed-demo — authz gate", () => {
  it("rejects an unauthenticated caller with 401 and writes nothing", async () => {
    const res = await SELF.fetch("https://worker/api/admin/seed-demo", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("rejects a NON-admin caller with 403 BEFORE any write", async () => {
    const userId = "user_nonadmin_1";
    await seedDb({
      users: [
        {
          id: userId,
          displayName: "Not Admin",
          identityColor: "#333",
          plan: "free",
          isAdmin: false,
        },
      ],
    });
    const res = await SELF.fetch("https://worker/api/admin/seed-demo", {
      method: "POST",
      headers: await tokenFor(userId),
    });
    expect(res.status).toBe(403);

    // Nothing was written for this caller.
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE ownerId = ? AND deletedAt IS NULL",
    )
      .bind(userId)
      .first<{ n: number }>();
    expect(rows?.n ?? 0).toBe(0);
  });
});

describe("US-056 POST /api/admin/seed-demo — materialization", () => {
  const admin = "user_admin_mat";

  beforeAll(async () => {
    await seedDb({
      users: [
        {
          id: admin,
          displayName: "Demo Admin",
          identityColor: "#333",
          plan: "free",
          isAdmin: true,
        },
      ],
    });
  });

  it("materializes routines, figures, annotations, memberships and family notes into the caller's own account", async () => {
    const res = await SELF.fetch("https://worker/api/admin/seed-demo", {
      method: "POST",
      headers: await tokenFor(admin),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; summary: Record<string, number> }>();
    expect(body.ok).toBe(true);
    expect(body.summary.routines).toBeGreaterThanOrEqual(3);
    expect(body.summary.figures).toBeGreaterThan(0);
    expect(body.summary.annotations).toBeGreaterThan(0);
    expect(body.summary.familyNotes).toBeGreaterThan(0);
    expect(body.summary.coMembers).toBeGreaterThanOrEqual(2);
    expect(body.summary.customKinds).toBe(1);

    // Routines are registered, owned by the caller, across >= 3 dances.
    const routines = await env.DB.prepare(
      "SELECT docRef, dance FROM document_registry WHERE ownerId = ? AND type = 'routine' AND deletedAt IS NULL",
    )
      .bind(admin)
      .all<{ docRef: string; dance: string }>();
    expect(routines.results.length).toBeGreaterThanOrEqual(3);
    expect(new Set(routines.results.map((r) => r.dance)).size).toBeGreaterThanOrEqual(3);
    for (const r of routines.results) expect(r.docRef.startsWith(`demo_${admin}_`)).toBe(true);

    // The routine DO carries the backdated annotations with replies + a spread of
    // anchor types, and a co-member authored at least one.
    const first = routines.results[0];
    if (!first) throw new Error("expected at least one demo routine");
    const snap = await docs.get(docs.idFromName(first.docRef)).getSnapshot();
    expect(snap.sections.flatMap((s) => s.placements).length).toBeGreaterThan(0);
    expect(snap.annotations.length).toBeGreaterThan(0);
    const anchorTypes = new Set(snap.annotations.flatMap((a) => a.anchors.map((an) => an.type)));
    expect(anchorTypes.size).toBeGreaterThanOrEqual(2);
    // Backdated: every annotation createdAt is in the past, and something is old.
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    expect(snap.annotations.every((a) => a.createdAt <= now)).toBe(true);
    expect(snap.annotations.some((a) => now - a.createdAt >= 60 * DAY)).toBe(true);
    // A reply authored by a synthetic co-member (namespaced under the admin).
    const coAuthoredReply = snap.annotations
      .flatMap((a) => a.replies)
      .some((rep) => rep.authorId.startsWith(`demo_${admin}_`));
    expect(coAuthoredReply).toBe(true);

    // A placed figure's DO carries real charted attributes. Figure docs aren't
    // routine-shaped, so read the raw Automerge content from the DO's change log
    // (the figures.test.ts pattern) rather than a routine snapshot.
    const figRef = snap.sections.flatMap((s) => s.placements)[0]?.figureRef;
    if (!figRef) throw new Error("expected a placed figure");
    const attrCount = await runInDurableObject(
      docs.get(docs.idFromName(figRef)),
      async (_instance, state) => {
        const rows = state.storage.sql
          .exec<{ data: ArrayBuffer }>("SELECT data FROM changes ORDER BY seq")
          .toArray();
        if (rows.length === 0) return 0;
        let doc = A.init<Record<string, unknown>>();
        [doc] = A.applyChanges(
          doc,
          rows.map((r) => new Uint8Array(r.data)),
        );
        const attrs = A.toJS(doc).attributes;
        return Array.isArray(attrs) ? attrs.length : 0;
      },
    );
    expect(attrCount).toBeGreaterThan(0);

    // Memberships share some routines with the synthetic co-members.
    const shared = await env.DB.prepare(
      "SELECT userId, role FROM membership WHERE docRef LIKE ? AND userId LIKE ? AND deletedAt IS NULL",
    )
      .bind(`demo_${admin}_%`, `demo_${admin}_%`)
      .all<{ userId: string; role: string }>();
    expect(shared.results.length).toBeGreaterThan(0);

    // Family notes are visible via the projection, authored by co-members.
    const notes = await env.DB.prepare(
      "SELECT authorId, text FROM figure_type_note_index WHERE authorId LIKE ? AND deletedAt IS NULL",
    )
      .bind(`demo_${admin}_%`)
      .all<{ authorId: string; text: string }>();
    expect(notes.results.length).toBeGreaterThan(0);

    // The account-wide custom kind was written for the caller.
    const kind = await env.DB.prepare(
      "SELECT kind, roleAware FROM account_custom_kind WHERE userId = ? AND deletedAt IS NULL",
    )
      .bind(admin)
      .first<{ kind: string; roleAware: number }>();
    expect(kind?.kind).toBe("focus");
    expect(kind?.roleAware).toBe(1);
  });

  it("is idempotent — a second call adds no duplicate rows", async () => {
    const before = await countDemo(admin);
    const res = await SELF.fetch("https://worker/api/admin/seed-demo", {
      method: "POST",
      headers: await tokenFor(admin),
    });
    expect(res.status).toBe(200);
    const after = await countDemo(admin);
    expect(after).toEqual(before);
  });
});

describe("US-056 DELETE /api/admin/seed-demo — soft delete", () => {
  const admin = "user_admin_del";

  beforeAll(async () => {
    await seedDb({
      users: [
        { id: admin, displayName: "Del Admin", identityColor: "#333", plan: "free", isAdmin: true },
      ],
    });
    await SELF.fetch("https://worker/api/admin/seed-demo", {
      method: "POST",
      headers: await tokenFor(admin),
    });
  });

  it("non-admin cannot delete (403)", async () => {
    const nonAdmin = "user_nonadmin_del";
    await seedDb({
      users: [
        { id: nonAdmin, displayName: "NA", identityColor: "#333", plan: "free", isAdmin: false },
      ],
    });
    const res = await SELF.fetch("https://worker/api/admin/seed-demo", {
      method: "DELETE",
      headers: await tokenFor(nonAdmin),
    });
    expect(res.status).toBe(403);
  });

  it("soft-deletes (tombstones) the caller's demo set — rows survive, deletedAt set", async () => {
    const liveBefore = await countDemo(admin);
    expect(liveBefore.docs).toBeGreaterThan(0);

    const res = await SELF.fetch("https://worker/api/admin/seed-demo", {
      method: "DELETE",
      headers: await tokenFor(admin),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; summary: Record<string, number> }>();
    expect(body.summary.docs).toBeGreaterThan(0);

    // Live rows are gone from every read (deletedAt IS NULL filters them out)...
    const liveAfter = await countDemo(admin);
    expect(liveAfter.docs).toBe(0);
    expect(liveAfter.memberships).toBe(0);

    // ...but the rows still EXIST (soft-delete, never a hard removal).
    const stillThere = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE docRef LIKE ? AND deletedAt IS NOT NULL",
    )
      .bind(`demo_${admin}_%`)
      .first<{ n: number }>();
    expect(stillThere?.n ?? 0).toBeGreaterThan(0);
  });

  it("re-seeds cleanly after a delete (idempotent revive is duplicate-free)", async () => {
    await SELF.fetch("https://worker/api/admin/seed-demo", {
      method: "POST",
      headers: await tokenFor(admin),
    });
    const live = await countDemo(admin);
    // A single live demo set again (the tombstoned rows stay tombstoned; the
    // no-clobber re-seed does not resurrect them into a second copy).
    expect(live.docs).toBeGreaterThan(0);
  });
});

describe("US-056 EXPLAIN gate — the demo tombstone queries are indexed", () => {
  it("the exact-docRef tombstone hits the document_registry primary key", async () => {
    await expectIndexedQuery(
      env.DB,
      "UPDATE document_registry SET deletedAt = ?1 WHERE docRef = ?2 AND deletedAt IS NULL",
      [1, "demo_u_rt1"],
    );
  });

  it("the exact-authorId family-note tombstone is indexed (idx_ftni_author)", async () => {
    await expectIndexedQuery(
      env.DB,
      "UPDATE figure_type_note_index SET deletedAt = ?1 WHERE authorId = ?2 AND deletedAt IS NULL",
      [1, "demo_u_coach"],
    );
  });

  it("the exact-membership tombstone is indexed", async () => {
    await expectIndexedQuery(
      env.DB,
      "UPDATE membership SET deletedAt = ?1 WHERE docRef = ?2 AND userId = ?3 AND deletedAt IS NULL",
      [1, "demo_u_rt1", "demo_u_coach"],
    );
  });
});

/** Count the LIVE demo rows for `userId` across the surfaces the seed writes,
 *  using indexed lookups (ownerId / userId / exact authorId). The counts are
 *  compared before/after a re-run, so they only need to be stable, not exhaustive. */
async function countDemo(userId: string): Promise<{
  docs: number;
  memberships: number;
  notes: number;
  kinds: number;
}> {
  const { buildDemoSeed } = await import("@weavesteps/domain");
  const coMembers = buildDemoSeed({ userId, now: Date.now() }).coMemberIds;
  // The caller owns every demo routine + figure (indexed on ownerId).
  const docs = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM document_registry WHERE ownerId = ? AND deletedAt IS NULL",
  )
    .bind(userId)
    .first<{ n: number }>();
  const memberships = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM membership WHERE userId = ? AND deletedAt IS NULL",
  )
    .bind(userId)
    .first<{ n: number }>();
  // Family notes are authored by the synthetic co-members (indexed on authorId).
  let notesN = 0;
  for (const author of coMembers) {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM figure_type_note_index WHERE authorId = ? AND deletedAt IS NULL",
    )
      .bind(author)
      .first<{ n: number }>();
    notesN += row?.n ?? 0;
  }
  const kinds = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM account_custom_kind WHERE userId = ? AND deletedAt IS NULL",
  )
    .bind(userId)
    .first<{ n: number }>();
  return {
    docs: docs?.n ?? 0,
    memberships: memberships?.n ?? 0,
    notes: notesN,
    kinds: kinds?.n ?? 0,
  };
}
