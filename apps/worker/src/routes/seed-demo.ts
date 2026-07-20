// US-056 — POST/DELETE /api/admin/seed-demo (docs/system/architecture.md § Ops /
// admin seams; docs/DEVELOPMENT.md § Seeding a staging demo account).
//
// HARD-GATED ADMIN OPS SURFACE. Lets an admin populate THEIR OWN account with a
// rich synthetic demo dataset (built by the pure `buildDemoSeed`) so staging can
// be exercised without hand-entering data. Safety is structural:
//
//  • the `isAdmin` gate (users.isAdmin — the same flag global-figure editing uses)
//    runs BEFORE any write; a non-admin is 403 with nothing written;
//  • the seed only ever writes into the CALLER's own account: routines/figures are
//    owned by the caller, and the synthetic co-members are NAMESPACED under the
//    caller (`demo_<caller>_coach` …) — they are author/member ids + account docs,
//    never real logins, and the route never writes into a non-caller REAL account;
//  • it is idempotent: every id is namespaced+deterministic and every D1 write is
//    a revive-on-conflict upsert on that id (and seedDoc is no-clobber for CRDT
//    content), so a re-run adds no duplicates AND a re-run AFTER a DELETE brings
//    the tombstoned demo set back live (clean re-seed);
//  • deletes are SOFT (deletedAt tombstones) — the DELETE side tombstones the
//    demo set by its exact ids so the owner can re-seed cleanly, never a hard
//    removal, never a row this seed didn't create.
//
// It is safe to mount in every environment: the gate + own-account-only writes
// make it inert for anyone but an admin acting on their own account.
import { zRegistryKind } from "@weavesteps/contract";
import { buildDemoSeed } from "@weavesteps/domain";
import { drizzle } from "drizzle-orm/d1";
import { upsertAccountKind } from "../db/custom-kinds";
import { documentRegistry, membership } from "../db/schema";
import type { Env } from "../index";

export interface SeedDemoSummary {
  routines: number;
  figures: number;
  annotations: number;
  memberships: number;
  familyNotes: number;
  coMembers: number;
  customKinds: number;
}

/**
 * Materialize the synthetic demo dataset into the ADMIN caller's own account via
 * the existing write seams. Idempotent: every id is deterministic + namespaced by
 * `userId`, and every D1 write is a revive-on-conflict upsert on that id (seedDoc
 * is no-clobber for CRDT content) — so a re-run adds no duplicates and a re-run
 * after a DELETE brings the tombstoned set back live. Returns a count summary.
 */
export async function materializeDemoSeed(env: Env, userId: string): Promise<SeedDemoSummary> {
  const seed = buildDemoSeed({ userId, now: Date.now() });
  const d = drizzle(env.DB);
  const now = Date.now();

  let annotations = 0;
  let familyNotes = 0;

  // 1. Routines + their figures. Figures FIRST so the routine's placement edges
  //    and cascade-access resolution work (the seedSampleRoutine ordering).
  for (const { routine, figures } of seed.routines) {
    for (const figure of figures) {
      // Registry row — an account-figure owned by the caller; never counts against
      // the routine quota. Revive-on-conflict (clears `deletedAt`) so a re-seed
      // AFTER a DELETE brings the demo set back live; the owner/type never change,
      // so this only ever touches this seed's own demo docs.
      await d
        .insert(documentRegistry)
        .values({
          docRef: figure.id,
          type: "account-figure",
          ownerId: userId,
          doName: figure.id,
          title: figure.name,
          dance: figure.dance,
          figureType: figure.figureType,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: documentRegistry.docRef,
          set: { deletedAt: null, updatedAt: now },
        });
      await d
        .insert(membership)
        .values({
          id: `mem_${userId}_${figure.id}`,
          docRef: figure.id,
          userId,
          role: "editor",
          createdAt: now,
        })
        .onConflictDoUpdate({ target: membership.id, set: { deletedAt: null } });
      // seedDoc is no-clobber: the CRDT figure content (incl. the custom-kind
      // attributes) is durable, never overwritten on a re-run.
      await env.DOC_DO.get(env.DOC_DO.idFromName(figure.id)).seedDoc(figure);
      // Placement edge so the routine→figure role cascade + "used in N" work.
      await env.DB.prepare(
        "INSERT OR IGNORE INTO placement_edge (routineRef, figureRef) VALUES (?, ?)",
      )
        .bind(routine.id, figure.id)
        .run();
    }

    // Registry row + owner membership for the routine (revive-on-conflict, NOT
    // createOwnedRoutine which throws on a re-run — idempotency + re-seed-after-
    // delete both need the no-throw revive).
    await d
      .insert(documentRegistry)
      .values({
        docRef: routine.id,
        type: "routine",
        ownerId: userId,
        doName: routine.id,
        title: routine.title,
        dance: routine.dance,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: documentRegistry.docRef,
        set: { deletedAt: null, updatedAt: now },
      });
    await d
      .insert(membership)
      .values({
        id: `mem_${userId}_${routine.id}`,
        docRef: routine.id,
        userId,
        role: "editor",
        createdAt: now,
      })
      .onConflictDoUpdate({ target: membership.id, set: { deletedAt: null } });

    // Seed the routine DO with the FULL content — sections, placements AND the
    // backdated annotations (with their replies + anchors) authored directly into
    // the doc, so the chosen `createdAt`s are preserved verbatim (seedDoc builds
    // the doc from this content; it does not re-stamp `now`).
    await env.DOC_DO.get(env.DOC_DO.idFromName(routine.id)).seedDoc(routine);
    annotations += routine.annotations.length;
  }

  // 2. Sharing: membership rows granting the synthetic co-members access to some
  //    routines. Revive-on-conflict (re-run + re-seed-after-delete are both clean);
  //    the granted role is refreshed to the seed's.
  for (const m of seed.memberships) {
    await d
      .insert(membership)
      .values({
        id: `mem_${m.userId}_${m.docRef}`,
        docRef: m.docRef,
        userId: m.userId,
        role: m.role,
        createdAt: now,
      })
      .onConflictDoUpdate({ target: membership.id, set: { deletedAt: null, role: m.role } });
  }

  // 3. Account docs (owner is untouched here — all demo family notes are authored
  //    BY co-members): seed each synthetic co-member's account DO with its
  //    backdated family-note annotations (self-describing doc), register it, and
  //    ALSO write the `figure_type_note_index` projection rows directly so the
  //    notes are immediately visible to the owner via co-membership (the read
  //    path) without waiting on the DO alarm. Every account here is namespaced
  //    under the caller — never a real user's account doc.
  for (const account of seed.accounts) {
    if (account.userId === userId) continue; // never touch the caller's REAL account doc
    const accountRef = account.doc.id; // `account:demo_<caller>_<role>`
    // Seed the account DO (no-clobber) with the backdated family notes in-content.
    await env.DOC_DO.get(env.DOC_DO.idFromName(accountRef)).seedDoc(account.doc);
    await env.DOC_DO.get(env.DOC_DO.idFromName(accountRef)).setMetadata({
      doName: accountRef,
      docRef: accountRef,
      type: "account",
      ownerId: account.userId,
    });
    await d
      .insert(documentRegistry)
      .values({
        docRef: accountRef,
        type: "account",
        ownerId: account.userId,
        doName: accountRef,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: documentRegistry.docRef,
        set: { deletedAt: null, updatedAt: now },
      });
    // Project each family note to the read index (idempotent on noteId).
    for (const note of account.doc.annotations) {
      const anchor = note.anchors.find((a) => a.type === "figureType");
      if (anchor?.type !== "figureType") continue;
      await insertFamilyNoteIdempotent(env, {
        noteId: note.id,
        authorId: account.userId,
        figureType: anchor.figureType,
        danceScope: anchor.danceScope,
        kind: note.kind,
        text: note.text,
        ...(anchor.count != null ? { count: anchor.count } : {}),
        ...(anchor.role != null ? { role: anchor.role } : {}),
      });
      familyNotes += 1;
    }
  }

  // 4. The account-wide custom kind (the deliberate D1-as-truth exception). Parse
  //    through the contract schema at the boundary — the runtime-validated narrow
  //    (never an `as`) from the domain RegistryKind to the write DTO. Upsert is
  //    idempotent on (userId, kind).
  const kindDto = zRegistryKind.parse(seed.customKind);
  await upsertAccountKind(env.DB, userId, kindDto, now);

  return {
    routines: seed.routines.length,
    figures: seed.routines.reduce((n, r) => n + r.figures.length, 0),
    annotations,
    memberships: seed.memberships.length,
    familyNotes,
    coMembers: seed.coMemberIds.length,
    customKinds: 1,
  };
}

/**
 * SOFT-DELETE the caller's demo set so they can re-seed cleanly. Rebuilds the
 * (deterministic) seed to recover the EXACT ids it wrote, then tombstones each by
 * exact match — so every UPDATE uses the primary-key / owner / author indexes (no
 * full-table LIKE scan) and can never touch a row this seed didn't create. Soft
 * delete only — `deletedAt` tombstones, never a hard removal (CLAUDE.md /
 * architecture § Global constraints). The caller's REAL account doc is never in the
 * demo id set, so it is untouched. Returns the counts tombstoned.
 */
export async function softDeleteDemoSeed(
  env: Env,
  userId: string,
): Promise<{ docs: number; memberships: number; customKinds: number; familyNotes: number }> {
  const now = Date.now();
  const seed = buildDemoSeed({ userId, now });

  // Every demo doc id: routines + their figures + the synthetic co-member account
  // docs. All namespaced `demo_<userId>_*` / `account:demo_<userId>_*`.
  const docRefs = [
    ...seed.routines.flatMap((r) => [r.routine.id, ...r.figures.map((f) => f.id)]),
    ...seed.accounts.filter((a) => a.userId !== userId).map((a) => a.doc.id),
  ];
  // Every membership row this seed writes: the owner's own rows on each demo doc,
  // plus the explicit sharing rows.
  const memberRows: { docRef: string; userId: string }[] = [
    ...seed.routines.map((r) => ({ docRef: r.routine.id, userId })),
    ...seed.routines.flatMap((r) => r.figures.map((f) => ({ docRef: f.id, userId }))),
    ...seed.memberships.map((m) => ({ docRef: m.docRef, userId: m.userId })),
  ];

  const docs = await tombstoneByDocRef(env, "document_registry", docRefs, now);
  const memberships = await tombstoneMemberships(env, memberRows, now);

  // Family notes: authored by the synthetic co-members — tombstone by exact
  // authorId (uses idx_ftni_author (authorId, deletedAt)).
  let familyNotes = 0;
  for (const coMember of seed.coMemberIds) {
    const res = await env.DB.prepare(
      "UPDATE figure_type_note_index SET deletedAt = ?1 WHERE authorId = ?2 AND deletedAt IS NULL",
    )
      .bind(now, coMember)
      .run();
    familyNotes += res.meta?.changes ?? 0;
  }

  // The account-wide demo custom kind (idempotent on (userId, kind)).
  const kindRes = await env.DB.prepare(
    "UPDATE account_custom_kind SET deletedAt = ?1 WHERE userId = ?2 AND kind = ?3 AND deletedAt IS NULL",
  )
    .bind(now, userId, seed.customKind.kind)
    .run();

  return {
    docs,
    memberships,
    familyNotes,
    customKinds: kindRes.meta?.changes ?? 0,
  };
}

/** Tombstone the given docRefs by exact match (uses the docRef PRIMARY KEY). Runs
 *  as one batch; returns how many rows flipped from live to tombstoned. */
async function tombstoneByDocRef(
  env: Env,
  table: "document_registry",
  docRefs: string[],
  now: number,
): Promise<number> {
  if (docRefs.length === 0) return 0;
  const stmts = docRefs.map((docRef) =>
    env.DB.prepare(
      `UPDATE ${table} SET deletedAt = ?1 WHERE docRef = ?2 AND deletedAt IS NULL`,
    ).bind(now, docRef),
  );
  const results = await env.DB.batch(stmts);
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}

/** Tombstone the given (docRef, userId) membership rows by exact match (uses
 *  membership_user_idx). Returns how many flipped from live to tombstoned. */
async function tombstoneMemberships(
  env: Env,
  rows: { docRef: string; userId: string }[],
  now: number,
): Promise<number> {
  if (rows.length === 0) return 0;
  const stmts = rows.map((r) =>
    env.DB.prepare(
      "UPDATE membership SET deletedAt = ?1 WHERE docRef = ?2 AND userId = ?3 AND deletedAt IS NULL",
    ).bind(now, r.docRef, r.userId),
  );
  const results = await env.DB.batch(stmts);
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}

/** Upsert a family-note projection row for the demo (the read-index the owner sees
 *  via co-membership). Idempotent on the stable `noteId` and REVIVING — a re-seed
 *  after a DELETE clears the tombstone, mirroring `projectFamilyNotes`. */
async function insertFamilyNoteIdempotent(
  env: Env,
  note: {
    noteId: string;
    authorId: string;
    figureType: string;
    danceScope: string;
    kind: string;
    text: string;
    count?: number;
    role?: string | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO figure_type_note_index (noteId, accountDocRef, authorId, figureType, danceScope, kind, text, count, role, updatedAt, deletedAt) ` +
      `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ` +
      `ON CONFLICT(noteId) DO UPDATE SET text = excluded.text, updatedAt = excluded.updatedAt, deletedAt = NULL`,
  )
    .bind(
      note.noteId,
      `account:${note.authorId}`,
      note.authorId,
      note.figureType,
      note.danceScope,
      note.kind,
      note.text,
      note.count ?? null,
      note.role ?? null,
      Date.now(),
    )
    .run();
}
