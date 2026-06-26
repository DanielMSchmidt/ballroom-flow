import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { authenticate } from "./auth";
import { users } from "./db/schema";

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

// Public WebSocket sync entrypoint for a document (US-017 Phase 1). Routes a
// `GET /docs/:id/connect` upgrade to that document's DO (one DO per document,
// keyed by `:id` via idFromName) and forwards the upgrade so the DO's
// Hibernatable-WS sync (US-015) takes over. We pass the doc name to the DO via
// the `x-doc-name` header because the DO can't recover its idFromName key from
// `ctx.id` (US-016).
//
// AUTH: this route is intentionally OPEN for now — per-connection auth +
// membership/role enforcement at the sync boundary is US-021 (M3). Until then
// anyone who knows a doc id can connect. MUST be gated before any real data.
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
