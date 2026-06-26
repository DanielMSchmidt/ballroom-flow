import { zCreateFigure, zCreateRoutine } from "@ballroom/contract";
import { newId } from "@ballroom/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { authenticate } from "./auth";
import { createFigureRows } from "./db/figures";
import { countOwnedRoutines, createOwnedRoutine, listRoutines } from "./db/routines";
import { users } from "./db/schema";

/** Free accounts may OWN at most this many routines (D21); the 4th upsells. */
const FREE_ROUTINE_CAP = 3;

export type Env = {
  DB: D1Database;
  // Per-document Automerge host (US-014, PLAN §6/D23): one DO per routine/figure
  // document, SQLite-backed, the sync + permission boundary.
  DOC_DO: DurableObjectNamespace;
  // Clerk verification keys — set as Wrangler secrets (see PROVISIONING.md).
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// GET /api/me — the verified Clerk identity (US-019 AC-3). The JWT is verified
// networklessly in auth/ (CLERK_JWT_KEY, no Clerk fetch). Returns the `sub`
// plus the account profile when the user has onboarded (else onboarded:false so
// the client can route into onboarding).
app.get("/api/me", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const db = drizzle(c.env.DB);
  const row = await db.select().from(users).where(eq(users.id, user.sub)).get();
  if (!row) return c.json({ sub: user.sub, onboarded: false });
  return c.json({
    sub: user.sub,
    onboarded: true,
    displayName: row.displayName,
    identityColor: row.identityColor,
    plan: row.plan,
  });
});

// POST /api/onboarding — capture the account's displayName + identity color
// (US-019 AC-2). Upsert keyed by the verified Clerk sub, so re-running it is
// idempotent (e.g. a retried first-run). Plan defaults to 'free' (billing is
// US-053/quota). A hex identityColor keeps annotation authorship legible (#5).
app.post("/api/onboarding", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    displayName?: unknown;
    identityColor?: unknown;
  } | null;
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const identityColor = typeof body?.identityColor === "string" ? body.identityColor.trim() : "";
  if (!displayName || !/^#[0-9a-fA-F]{3,8}$/.test(identityColor)) {
    return c.json({ error: "invalid_profile" }, 400);
  }

  const db = drizzle(c.env.DB);
  await db
    .insert(users)
    .values({ id: user.sub, displayName, identityColor, plan: "free", createdAt: Date.now() })
    .onConflictDoUpdate({ target: users.id, set: { displayName, identityColor } });

  return c.json({ sub: user.sub, displayName, identityColor, plan: "free" });
});

// POST /api/routines — create a routine (US-025 server path) with the SERVER-SIDE
// quota gate (US-022). A free account may OWN at most FREE_ROUTINE_CAP routines;
// the 4th create is refused with a structured upsell payload (402) the UI renders
// — NOT a generic 403. The quota is enforced here so a client bypass is still
// blocked. Only OWNED routines count (shared-in membership rows don't). On allow
// we EAGER-project the registry row + the owner membership (createOwnedRoutine);
// the CRDT doc is created lazily by its DO on first open (US-025 seeds content).
app.post("/api/routines", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  // Validate against the SHARED contract schema (#79 home) — title is trimmed +
  // non-empty + length-capped, dance is one of the five; web + worker agree.
  const parsed = zCreateRoutine.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_routine", issues: parsed.error.flatten() }, 400);
  }
  const { title, dance } = parsed.data;

  const db = drizzle(c.env.DB);
  const me = await db.select({ plan: users.plan }).from(users).where(eq(users.id, user.sub)).get();
  const plan = me?.plan ?? "free";

  // SERVER-SIDE quota: count OWNED routines (indexed; shared-in excluded).
  const owned = await countOwnedRoutines(c.env.DB, user.sub);
  if (plan === "free" && owned >= FREE_ROUTINE_CAP) {
    return c.json({ upsell: true, reason: "quota", cap: FREE_ROUTINE_CAP, owned, plan }, 402);
  }

  const docRef = newId();
  await createOwnedRoutine(c.env.DB, { docRef, ownerId: user.sub, title, dance });
  return c.json({ docRef, title, dance, plan }, 201);
});

// POST /api/figures — project a client-minted figure doc to the D1 index (#187).
// The client mints the figureRef + metadata; the SERVER stamps ownerId from the
// verified JWT (never a client field). Projecting the registry row + owner
// membership is what lets the fail-closed DO boundary (US-021) owner-resolve a
// connect to that figure (101, not 403). Idempotent on figureRef. Figures are
// NOT counted against the routine quota (type="figure" ≠ "routine").
app.post("/api/figures", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const parsed = zCreateFigure.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_figure", issues: parsed.error.flatten() }, 400);
  }
  const { figureRef, name, dance, figureType } = parsed.data;

  await createFigureRows(c.env.DB, { figureRef, ownerId: user.sub, name, dance, figureType });
  return c.json({ figureRef, name, dance, figureType, ownerId: user.sub }, 201);
});

// GET /api/routines — the Choreo list (US-025): the viewer's owned + shared-in
// routines (newest first), served from the D1 index (no CRDT content read). A
// just-created routine appears immediately (eager projection); edit metadata is
// alarm-projected and may lag (#126).
app.get("/api/routines", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const routines = await listRoutines(c.env.DB, user.sub);
  return c.json({ routines });
});

// Public WebSocket sync entrypoint for a document (US-017 Phase 1). Routes a
// `GET /docs/:id/connect` upgrade to that document's DO (one DO per document,
// keyed by `:id` via idFromName) and forwards the upgrade so the DO's
// Hibernatable-WS sync (US-015) takes over. We pass the doc name to the DO via
// the `x-doc-name` header because the DO can't recover its idFromName key from
// `ctx.id` (US-016).
//
// AUTH: the DO connection is the permission boundary (US-021) — it is fail-closed
// (a valid Clerk token + per-doc membership are REQUIRED; verified inside the DO).
// This route only forwards the upgrade (and the Authorization + x-doc-name
// headers); it deliberately does not re-authorize.
app.get("/docs/:id/connect", (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("expected websocket upgrade", 426);
  }
  const id = c.req.param("id");
  const stub = c.env.DOC_DO.get(c.env.DOC_DO.idFromName(id));
  // Forward the original upgrade request, adding the doc name for the DO.
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-doc-name", id);
  return stub.fetch(new Request(c.req.raw.url, { headers, method: "GET" }));
});

export type AppType = typeof app;
export default app;

// The per-document Durable Object must be exported from the Worker entry so the
// runtime can instantiate it for the `DOC_DO` binding (wrangler.toml).
export { DocDO } from "./doc-do";
