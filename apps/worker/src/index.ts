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

export type AppType = typeof app;
export default app;

// The per-document Durable Object must be exported from the Worker entry so the
// runtime can instantiate it for the `DOC_DO` binding (wrangler.toml).
export { DocDO } from "./doc-do";
