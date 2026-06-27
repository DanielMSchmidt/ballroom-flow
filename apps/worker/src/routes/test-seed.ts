// E2E-ONLY test fixtures endpoint (#191). These routes seed/reset the D1 index
// so the Playwright journeys start from deterministic state. They are mounted
// ONLY when `env.E2E_TEST_ROUTES === "1"` (set solely by the E2E wrangler run,
// see wrangler.toml [env.e2e]) — never in dev/staging/prod, where the flag is
// unset and the routes 404. They mirror the seedDb shape used by the worker
// unit tests, but write to the live D1 binding via drizzle.
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { documentRegistry, membership, users } from "../db/schema";
import type { Env } from "../index";

interface SeedBody {
  users?: { id: string; displayName: string; identityColor: string; plan?: "free" | "pro" }[];
  docs?: {
    docRef: string;
    type: string;
    ownerId: string;
    doName?: string;
    title?: string | null;
    dance?: string | null;
    figureType?: string | null;
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
        createdAt: now,
      })
      .onConflictDoNothing();
    seeded++;
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

  return c.json({ ok: true, seeded });
});
