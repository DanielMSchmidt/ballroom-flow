import { Hono } from "hono";
import { authenticate } from "./auth";

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

app.get("/api/me", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  return c.json({ sub: user.sub });
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
