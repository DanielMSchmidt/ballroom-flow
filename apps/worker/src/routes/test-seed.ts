// E2E-ONLY test fixtures endpoint (#191). These routes seed/reset the D1 index
// so the Playwright journeys start from deterministic state. They are mounted
// ONLY when `env.E2E_TEST_ROUTES === "1"` (set solely by the E2E wrangler run,
// see wrangler.toml [env.e2e]) — never in dev/staging/prod, where the flag is
// unset and the routes 404. They mirror the seedDb shape used by the worker
// unit tests, but write to the live D1 binding via drizzle.
import { zSeedBody } from "@weavesteps/contract";
import { CURRENT_SCHEMA_VERSION, isDanceId, parseAttributeRead } from "@weavesteps/domain";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { documentRegistry, libraryEntry, membership, users } from "../db/schema";
import type { Env } from "../index";
import { seedGlobalFigures } from "../seed-global-figures";

// The seed body's shape + runtime validator live in @weavesteps/contract
// (`zSeedBody`) — parsed at the route below, so a malformed seed fails loudly
// instead of being silently cast and corrupting a journey's fixtures.

export const testSeed = new Hono<{ Bindings: Env }>();

/** Wipe the index tables (deterministic per-run reset). */
testSeed.post("/api/test/reset", async (c) => {
  const d = drizzle(c.env.DB);
  // Wipe each registered doc's Durable Object storage BEFORE clearing D1. A DO's
  // SQLite persists independently of D1 and `seedDoc` is no-clobber, so a doc
  // mutated in one journey/project (e.g. a copy-on-write edit that re-points a
  // routine placement) would otherwise leak into the next run — the stale
  // placement points at a now-orphaned figure copy and the card hangs on
  // "Loading figure…". document_registry lists every seeded/created docRef
  // (routines, figures, and COW copies alike), so this generically resets them
  // all. Reading it here, before the DELETE below, is intentional.
  const registered = await c.env.DB.prepare("SELECT docRef FROM document_registry").all<{
    docRef: string;
  }>();
  for (const { docRef } of registered.results ?? []) {
    await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(docRef)).resetForTest();
  }
  // `invite` is created by migration 0001 but typed in drizzle only once US-023
  // lands; clear it via raw SQL so this endpoint is independent of that merge.
  await c.env.DB.prepare("DELETE FROM invite").run();
  // Family-note index (US-040/041). Authored against a STABLE per-user account
  // ref (`account:<userId>`), so without this a reused seed user accumulates the
  // same note across serial journeys/projects — raw SQL to stay independent of
  // the drizzle schema's merge timeline (mirrors `invite`).
  await c.env.DB.prepare("DELETE FROM figure_type_note_index").run();
  // Journal index (T6). The routine DO alarm projects lesson/practice annotations
  // here; clear it so a reused seed routine doesn't accumulate stale entries across
  // serial journeys (mirrors figure_type_note_index). Raw SQL to stay independent
  // of the drizzle schema's merge timeline.
  await c.env.DB.prepare("DELETE FROM journal_entry").run();
  // placement_edge has no FK cascade — clear explicitly so COW test seeds start clean.
  await c.env.DB.prepare("DELETE FROM placement_edge").run();
  // Media grants/counter (annotation-media-embeds). Keyed by objectKey, not by
  // documentRegistry, so a reused seed user's byte budget would otherwise leak
  // across serial journeys/projects. Raw SQL to stay independent of the drizzle
  // schema's merge timeline (mirrors figure_type_note_index / journal_entry).
  await c.env.DB.prepare("DELETE FROM media_object").run();
  // Save-to-library bookmarks (T5). `alreadySaved` is decided purely by a
  // `library_entry` row keyed on (userId, figureRef) — NOT by documentRegistry —
  // so without this a figure saved by one journey/project leaks into the next:
  // the next save returns `alreadySaved: true` ("Already in My figures") instead
  // of "Saved to My figures". Because all three Playwright projects share one D1
  // serially, chromium-desktop (first) would pass while mobile-chrome/-safari fail.
  await d.delete(libraryEntry);
  await d.delete(membership);
  await d.delete(documentRegistry);
  await d.delete(users);
  return c.json({ ok: true });
});

/** Insert index rows (users / docs / memberships / invites). Idempotent upserts. */
testSeed.post("/api/test/seed", async (c) => {
  const body = zSeedBody.parse(await c.req.json().catch(() => ({})));
  const d = drizzle(c.env.DB);
  const now = Date.now();
  let seeded = 0;

  for (const u of body.users ?? []) {
    await d
      .insert(users)
      .values({
        id: u.id,
        displayName: u.displayName,
        identityColor: u.identityColor,
        plan: u.plan ?? "free",
        isAdmin: u.isAdmin ?? false,
        routineCapOverride: u.routineCapOverride ?? null,
        createdAt: now,
      })
      .onConflictDoNothing();
    seeded++;
  }

  // ⟳v5 — additively stand up the global figure docs (same seeder as the admin
  // route), so a journey can place live catalog references. Idempotent.
  if (body.seedGlobalFigures) {
    await seedGlobalFigures(c.env);
  }
  for (const doc of body.docs ?? []) {
    await d
      .insert(documentRegistry)
      .values({
        docRef: doc.docRef,
        type: doc.type,
        ownerId: doc.ownerId,
        doName: doc.doName ?? doc.docRef,
        title: doc.title ?? null,
        dance: doc.dance ?? null,
        figureType: doc.figureType ?? null,
        updatedAt: now,
      })
      .onConflictDoNothing();
    seeded++;
    // When a routine doc has explicit sections, server-seed the routine DO so
    // the placements are persisted before E2E connects (mirrors the create flow).
    if (doc.type === "routine" && doc.sections) {
      await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(doc.docRef)).seedDoc({
        id: doc.docRef,
        title: doc.title ?? "",
        dance: isDanceId(doc.dance) ? doc.dance : "waltz",
        ownerId: doc.ownerId,
        sections: doc.sections.map((s) => ({
          id: s.id,
          name: s.name,
          placements: s.placements.map((p) => ({
            id: p.id,
            figureRef: p.figureRef,
            deletedAt: null,
          })),
        })),
        // E2E-only: backdated routine annotations (comment activity fade-out
        // journeys). The UI stamps Date.now() on create, so an explicit
        // createdAt can only arrive through this seed seam. Values are already
        // Zod-parsed by zSeedBody — no casts.
        annotations: (doc.annotations ?? []).map((a) => ({
          id: a.id,
          authorId: a.authorId,
          kind: a.kind,
          text: a.text,
          tags: [],
          anchors: a.anchors,
          replies: (a.replies ?? []).map((r) => ({
            id: r.id,
            authorId: r.authorId,
            text: r.text,
            createdAt: r.createdAt,
            deletedAt: null,
          })),
          createdAt: a.createdAt,
          deletedAt: null,
        })),
        schemaVersion: CURRENT_SCHEMA_VERSION,
        deletedAt: null,
      });
    }
  }
  for (const m of body.memberships ?? []) {
    await d
      .insert(membership)
      .values({
        id: m.id ?? `mem_${m.userId}_${m.docRef}`,
        docRef: m.docRef,
        userId: m.userId,
        role: m.role,
        createdAt: now,
      })
      .onConflictDoNothing();
    seeded++;
  }
  for (const i of body.invites ?? []) {
    // Raw SQL: `invite` is typed in drizzle only with US-023; keep independent.
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO invite (id, docRef, role, expiresAt, redeemedAt) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(i.id, i.docRef, i.role, i.expiresAt, i.redeemedAt ?? null)
      .run();
    seeded++;
  }
  for (const f of body.figures ?? []) {
    // Project the figure to D1 (global-figure or account-figure type).
    await d
      .insert(documentRegistry)
      .values({
        docRef: f.docRef,
        type: f.scope === "global" ? "global-figure" : "account-figure",
        ownerId: f.ownerId,
        doName: f.docRef,
        title: f.name,
        dance: f.dance,
        figureType: f.figureType,
        updatedAt: now,
      })
      .onConflictDoNothing();
    // Server-seed the figure DO (no-clobber) so the CRDT content is durable
    // before E2E connects — same pattern as POST /api/figures.
    await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(f.docRef)).seedDoc({
      id: f.docRef,
      scope: f.scope,
      ownerId: f.ownerId,
      figureType: f.figureType,
      dance: isDanceId(f.dance) ? f.dance : "waltz",
      name: f.name,
      source: f.scope === "global" ? "library" : "custom",
      // Lenient-read parse (throws on structurally-invalid seed attributes —
      // a bad fixture should fail at seed time, not corrupt the journey).
      attributes: (f.attributes ?? []).map((a) => parseAttributeRead(a)),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      deletedAt: null,
    });
    seeded++;
  }
  for (const e of body.placementEdges ?? []) {
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO placement_edge (routineRef, figureRef) VALUES (?, ?)",
    )
      .bind(e.routineRef, e.figureRef)
      .run();
    seeded++;
  }
  for (const j of body.journalEntries ?? []) {
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO journal_entry (entryId, routineRef, authorId, kind, text, anchors, createdAt, updatedAt, deletedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        j.entryId,
        j.routineRef,
        j.authorId,
        j.kind,
        j.text,
        JSON.stringify(j.anchors ?? []),
        j.createdAt ?? now,
        now,
        j.deletedAt ?? null,
      )
      .run();
    seeded++;
  }

  return c.json({ ok: true, seeded });
});
