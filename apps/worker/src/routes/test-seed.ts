// E2E-ONLY test fixtures endpoint (#191). These routes seed/reset the D1 index
// so the Playwright journeys start from deterministic state. They are mounted
// ONLY when `env.E2E_TEST_ROUTES === "1"` (set solely by the E2E wrangler run,
// see wrangler.toml [env.e2e]) — never in dev/staging/prod, where the flag is
// unset and the routes 404. They mirror the seedDb shape used by the worker
// unit tests, but write to the live D1 binding via drizzle.
import { CURRENT_SCHEMA_VERSION } from "@ballroom/domain";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { documentRegistry, membership, users } from "../db/schema";
import type { Env } from "../index";
import { seedGlobalFigures } from "../seed-global-figures";

interface SeedBody {
  users?: {
    id: string;
    displayName: string;
    identityColor: string;
    plan?: "free" | "pro";
    /** D31 admin seam — lets an E2E journey stand up an admin (global-figure editor). */
    isAdmin?: boolean;
    routineCapOverride?: number | null;
  }[];
  /** ⟳v5 — stand up the REAL global figure docs from the bundled catalog (the same
   *  additive seeder the admin route runs) so a journey can place live catalog
   *  references. */
  seedGlobalFigures?: boolean;
  docs?: {
    docRef: string;
    type: string;
    ownerId: string;
    doName?: string;
    title?: string | null;
    dance?: string | null;
    figureType?: string | null;
    /** When type==="routine" and sections are present, the routine DO is server-seeded. */
    sections?: {
      id: string;
      name: string;
      placements: { id: string; figureRef: string }[];
    }[];
  }[];
  memberships?: {
    id?: string;
    docRef: string;
    userId: string;
    role: "viewer" | "commenter" | "editor";
  }[];
  invites?: {
    id: string;
    docRef: string;
    role: "viewer" | "commenter" | "editor";
    expiresAt: number;
    redeemedAt?: number | null;
  }[];
  /** Seed figure docs: D1 registry row + figure DO CRDT content. */
  figures?: {
    docRef: string;
    scope: "global" | "account";
    ownerId: string;
    name: string;
    dance: string;
    figureType: string;
    attributes?: unknown[];
  }[];
  /** Direct placement_edge rows (routine→figure) for the access cascade. */
  placementEdges?: { routineRef: string; figureRef: string }[];
  /** Direct journal_entry rows (T6) — the routine-scoped projection, for tests
   *  that want entries without driving the DO alarm. */
  journalEntries?: {
    entryId: string;
    routineRef: string;
    authorId: string;
    kind: "lesson" | "practice";
    text: string;
    anchors?: unknown[];
    createdAt?: number;
    deletedAt?: number | null;
  }[];
}

export const testSeed = new Hono<{ Bindings: Env }>();

/** Wipe the index tables (deterministic per-run reset). */
testSeed.post("/api/test/reset", async (c) => {
  const d = drizzle(c.env.DB);
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
  await d.delete(membership);
  await d.delete(documentRegistry);
  await d.delete(users);
  return c.json({ ok: true });
});

/** Insert index rows (users / docs / memberships / invites). Idempotent upserts. */
testSeed.post("/api/test/seed", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as SeedBody;
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
        dance: doc.dance ?? "waltz",
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
        annotations: [],
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
      dance: f.dance,
      name: f.name,
      source: f.scope === "global" ? "library" : "custom",
      attributes: f.attributes ?? [],
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
