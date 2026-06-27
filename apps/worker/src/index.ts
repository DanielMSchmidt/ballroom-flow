import { zCreateFigure, zCreateRoutine, zIssueInvite } from "@ballroom/contract";
import { can, newId } from "@ballroom/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { authenticate } from "./auth";
import { familyNotesForMembers, insertFamilyNote } from "./db/family-notes";
import { createFigureRows } from "./db/figures";
import { issueInvite, redeemInvite } from "./db/invites";
import { listMembers, removeMember, resolveEffectiveRole } from "./db/membership";
import { linkPlacement } from "./db/placement-edge";
import { countOwnedRoutines, createOwnedRoutine, listRoutines } from "./db/routines";
import { users } from "./db/schema";
import type { DocDO } from "./doc-do";
import { testSeed } from "./routes/test-seed";

/** Free accounts may OWN at most this many routines (D21); the 4th upsells. */
const FREE_ROUTINE_CAP = 3;

export type Env = {
  DB: D1Database;
  // Per-document Automerge host (US-014, PLAN §6/D23): one DO per routine/figure
  // document, SQLite-backed, the sync + permission boundary. Typed with the DO
  // class so the create routes can call its RPC (seedDoc, #205).
  DOC_DO: DurableObjectNamespace<DocDO>;
  // Clerk verification keys — set as Wrangler secrets (see PROVISIONING.md).
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
  // "1" ONLY in the E2E wrangler run (wrangler.toml [env.e2e]); mounts the
  // /api/test/* fixtures routes. Unset everywhere else → those routes 404.
  E2E_TEST_ROUTES?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// E2E-only test fixtures (#191). Guarded so these routes exist ONLY when the
// E2E wrangler run sets E2E_TEST_ROUTES=1 — in dev/staging/prod the flag is
// unset and the routes 404 (never a backdoor into a real environment).
app.use("/api/test/*", async (c, next) => {
  if (c.env.E2E_TEST_ROUTES !== "1") return c.json({ error: "not_found" }, 404);
  await next();
});
app.route("/", testSeed);

// GET /api/me — the verified Clerk identity (US-019 AC-3). The JWT is verified
// networklessly in auth/ (CLERK_JWT_KEY, no Clerk fetch). Returns the `sub`
// plus the account profile when the user has onboarded (else onboarded:false so
// the client can route into onboarding).
app.get("/api/me", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const db = drizzle(c.env.DB);
  const row = await db.select().from(users).where(eq(users.id, user.sub)).get();
  if (!row) return c.json({ sub: user.sub, onboarded: false, routineCap: FREE_ROUTINE_CAP });
  return c.json({
    sub: user.sub,
    onboarded: true,
    displayName: row.displayName,
    identityColor: row.identityColor,
    plan: row.plan,
    // The free-plan owned-routine cap, sourced from the ONE server constant so the
    // client never hardcodes a second copy (#176) — the Choreo list gates the
    // upsell on this, and the POST /api/routines 402 enforces the same value.
    routineCap: FREE_ROUTINE_CAP,
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
  // Server-seed the routine's CRDT content durably at create (#201/#109), so its
  // title/dance is DO-persisted before any client connects — the Assemble header
  // shows the real title, never "Untitled routine", and survives an immediate reload.
  await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(docRef)).seedDoc({
    id: docRef,
    title,
    dance,
    ownerId: user.sub,
    sections: [],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });
  return c.json({ docRef, title, dance, plan }, 201);
});

// POST /api/routines/:id/fork — choreo fork, "make it your own" (US-037). Any
// MEMBER of the origin (resolveEffectiveRole non-null; non-member 403) may fork
// it into a NEW owned routine. The fork is FROZEN + INDEPENDENT: we snapshot the
// origin's CRDT content and seed a brand-new doc with it (no shared history), so
// later origin edits never appear in the fork. `forkedFromRef` records lineage
// (provenance only — nothing pulls from it). Referenced figures stay shared (the
// placements keep their figureRefs). A fork COUNTS against the forker's quota.
app.post("/api/routines/:id/fork", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const originRef = c.req.param("id");
  // Must be able to read the origin to fork it (member/owner) — else 403.
  const role = await resolveEffectiveRole(c.env.DB, originRef, user.sub);
  if (!role) return c.json({ error: "forbidden" }, 403);

  // A fork is a new OWNED routine → subject to the same server-side quota as create.
  const db = drizzle(c.env.DB);
  const me = await db.select({ plan: users.plan }).from(users).where(eq(users.id, user.sub)).get();
  const plan = me?.plan ?? "free";
  const owned = await countOwnedRoutines(c.env.DB, user.sub);
  if (plan === "free" && owned >= FREE_ROUTINE_CAP) {
    return c.json({ upsell: true, reason: "quota", cap: FREE_ROUTINE_CAP, owned, plan }, 402);
  }

  // Snapshot the origin's resolved content and clone it into a fresh, owned doc.
  const origin = await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(originRef)).getSnapshot();
  const docRef = newId();
  const title = origin.title ?? "Untitled routine";
  const dance = origin.dance ?? "waltz";
  await createOwnedRoutine(c.env.DB, {
    docRef,
    ownerId: user.sub,
    title,
    dance,
    forkedFromRef: originRef,
  });
  // Seed the new DO with the cloned content: keep sections/placements/annotations
  // (figures stay shared via their figureRefs); re-stamp identity (new id, owner,
  // lineage). No shared Automerge history ⇒ the fork is frozen from the origin.
  await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(docRef)).seedDoc({
    ...origin,
    id: docRef,
    ownerId: user.sub,
    forkedFromRef: originRef,
    schemaVersion: origin.schemaVersion ?? 1,
    deletedAt: null,
  });
  return c.json({ docRef, forkedFromRef: originRef, title, dance, plan }, 201);
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
  const { figureRef, name, dance, figureType, routineId } = parsed.data;

  await createFigureRows(c.env.DB, { figureRef, ownerId: user.sub, name, dance, figureType });
  // Record the routine→figure edge so the routine's co-members get read access to
  // this figure (cascade): figure docs are otherwise shared independently (US-020).
  await linkPlacement(c.env.DB, routineId, figureRef);
  // Server-seed the figure's CRDT content durably at create (#205), so the figure
  // name/attributes are DO-persisted before the client connects — no racy client
  // seed write that can be lost on a reload right after "Add figure".
  await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(figureRef)).seedDoc({
    id: figureRef,
    scope: "account",
    ownerId: user.sub,
    figureType,
    dance,
    name,
    source: "custom",
    attributes: [],
    schemaVersion: 1,
    deletedAt: null,
  });
  return c.json({ figureRef, name, dance, figureType, ownerId: user.sub }, 201);
});

// GET /api/routines/:id/family-notes — the co-member family-note read (US-041,
// option 2). Surfaces the family notes authored by THIS routine's members that
// apply to its dance, so the client can show a co-member's "every Feather" note
// on the matching figure. In v1 a note's content lives in the figure_type_note_
// index row (server-mediated; see migration 0005), so this returns it directly —
// the client never reads another user's account doc. The co-membership gate is
// the security boundary: a NON-member is refused (403) before any note is read
// (AC-3/4). The query is keyed by members(R) + dance scope; the client then
// matches each note to the figures actually in R (resolveFamilyNotesFor).
app.get("/api/routines/:id/family-notes", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const routineRef = c.req.param("id");

  // Gate on co-membership of the routine: a non-member resolves to null → 403.
  const role = await resolveEffectiveRole(c.env.DB, routineRef, user.sub);
  if (!role) return c.json({ error: "forbidden" }, 403);

  // The routine's dance scopes which family notes apply (its dance, or "all").
  const reg = await c.env.DB.prepare("SELECT dance FROM document_registry WHERE docRef = ?")
    .bind(routineRef)
    .first<{ dance: string | null }>();
  const dance = reg?.dance ?? "waltz";

  const members = await listMembers(c.env.DB, routineRef);
  const authorIds = members.map((m) => m.userId);
  const rows = await familyNotesForMembers(c.env.DB, authorIds, dance);
  // Shape each row as an Annotation-like note (with a figureType anchor) so the
  // client can match it to the routine's figures (resolveFamilyNotesFor).
  const notes = rows.map((r) => ({
    id: r.noteId,
    authorId: r.authorId,
    kind: r.kind,
    text: r.text,
    figureType: r.figureType,
    danceScope: r.danceScope,
    anchors: [{ type: "figureType", figureType: r.figureType, danceScope: r.danceScope }],
  }));
  return c.json({ notes });
});

// POST /api/account/family-notes — author a figure-FAMILY note (US-040). The note
// is owned by the caller (authorId from the verified JWT) and scoped to a figure
// family + dance scope (this dance, or "all"). Server-mediated: the client never
// writes another account's data. Co-members then discover it via the route above.
app.post("/api/account/family-notes", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    kind?: unknown;
    text?: unknown;
    figureType?: unknown;
    danceScope?: unknown;
  } | null;
  const kind = body?.kind;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const figureType = body?.figureType;
  const danceScope = body?.danceScope;
  if (
    (kind !== "note" && kind !== "lesson" && kind !== "practice") ||
    !text ||
    typeof figureType !== "string" ||
    !figureType ||
    typeof danceScope !== "string" ||
    !danceScope
  ) {
    return c.json({ error: "invalid_family_note" }, 400);
  }

  const noteId = newId();
  await insertFamilyNote(c.env.DB, {
    noteId,
    authorId: user.sub,
    figureType,
    danceScope,
    kind,
    text,
  });
  return c.json({ id: noteId, authorId: user.sub, figureType, danceScope, kind, text }, 201);
});

// POST /api/docs/:id/invites — issue a shareable invite (US-023 AC-1/AC-4). Only
// a member who can invite (owner/editor via resolveEffectiveRole + can()) may
// mint one; everyone else → 403 (a non-member resolves to null → also 403). The
// granted role is validated against the contract (viewer/commenter/editor — never
// "owner"). The token is unguessable and its role/docRef live in D1, so a
// redeemer can't escalate (see db/invites.ts).
app.post("/api/docs/:id/invites", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const docRef = c.req.param("id");
  const effective = await resolveEffectiveRole(c.env.DB, docRef, user.sub);
  if (!effective || !can(effective, "canInvite")) {
    return c.json({ error: "forbidden" }, 403);
  }

  const parsed = zIssueInvite.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_invite", issues: parsed.error.flatten() }, 400);
  }

  const { token, expiresAt } = await issueInvite(c.env.DB, { docRef, role: parsed.data.role });
  return c.json({ token, role: parsed.data.role, expiresAt }, 201);
});

// POST /api/invites/:token/redeem — redeem an invite (US-023 AC-2/AC-3). Grants
// the REDEEMING user (the verified JWT sub, never a client field) the invite's
// role on its doc; single-use + expiry enforced in db/invites.ts. Unknown → 404,
// expired → 410, already-redeemed → 409 (clear errors, never a 500).
app.post("/api/invites/:token/redeem", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const result = await redeemInvite(c.env.DB, c.req.param("token"), user.sub);
  if (!result.ok) {
    if (result.reason === "not_found") return c.json({ error: "invite_not_found" }, 404);
    if (result.reason === "expired") return c.json({ error: "invite_expired" }, 410);
    return c.json({ error: "invite_already_redeemed" }, 409);
  }
  return c.json({ docRef: result.docRef, role: result.role }, 200);
});

// GET /api/docs/:id/members — the Share screen's member list (US-024 AC-1). Any
// MEMBER may read the roster (resolveEffectiveRole → non-null); a non-member 403s.
app.get("/api/docs/:id/members", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const docRef = c.req.param("id");
  const role = await resolveEffectiveRole(c.env.DB, docRef, user.sub);
  if (!role) return c.json({ error: "forbidden" }, 403);
  return c.json({ members: await listMembers(c.env.DB, docRef) });
});

// DELETE /api/docs/:id/members/:userId — remove a member (US-024 AC-2). Only a
// role that can manage membership (editor/owner via can(role,"canInvite")) may
// remove; commenter/viewer → 403. Soft-delete only (tombstone), never hard removal.
app.delete("/api/docs/:id/members/:userId", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const docRef = c.req.param("id");
  const role = await resolveEffectiveRole(c.env.DB, docRef, user.sub);
  if (!role || !can(role, "canInvite")) return c.json({ error: "forbidden" }, 403);
  await removeMember(c.env.DB, docRef, c.req.param("userId"));
  return c.json({ ok: true }, 200);
});

// GET /api/docs/:id/access — the viewer's OWN effective role on a document, used
// by the client to distinguish DENIED from offline before opening the heavy WS
// store (FE-2 / #178). A browser WebSocket can't read the WS handshake's 401/403
// (it only sees an abnormal 1006 close, indistinguishable from a transient
// disconnect), so the calm access-denied state is driven by this browser-readable
// preflight — the fail-closed DO sync boundary (US-021) is still the real gate.
//   • unauthenticated → 401  • non-member → 403  • member/owner → 200 { role }
app.get("/api/docs/:id/access", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const role = await resolveEffectiveRole(c.env.DB, c.req.param("id"), user.sub);
  if (!role) return c.json({ error: "forbidden" }, 403);
  return c.json({ role }, 200);
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
// AUTH (#189): a browser WS handshake can't set an Authorization header, so the
// client offers the Clerk token as a `Sec-WebSocket-Protocol` subprotocol
// (`ballroom.auth, <token>`). This route extracts the token and forwards it to
// the DO as `Authorization: Bearer …` (worker→DO fetch CAN set headers). The DO's
// US-021 fail-closed boundary then authenticates it UNCHANGED — this route only
// delivers the token, it does not re-authorize. On a 101 we echo the selected
// subprotocol (browsers fail the handshake unless the server selects one offered).
const AUTH_SUBPROTOCOL = "ballroom.auth";

app.get("/docs/:id/connect", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("expected websocket upgrade", 426);
  }
  const id = c.req.param("id");
  const stub = c.env.DOC_DO.get(c.env.DOC_DO.idFromName(id));

  const headers = new Headers(c.req.raw.headers);
  headers.set("x-doc-name", id);

  // Pull the bearer token out of the auth subprotocol → Authorization header.
  const offered = (c.req.header("Sec-WebSocket-Protocol") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const hasAuthProto = offered.includes(AUTH_SUBPROTOCOL);
  const token = hasAuthProto ? offered.find((p) => p !== AUTH_SUBPROTOCOL) : undefined;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await stub.fetch(new Request(c.req.raw.url, { headers, method: "GET" }));

  // Echo the auth subprotocol on a successful upgrade so the browser completes
  // the handshake (it requires the server to select one of the offered protocols).
  if (res.status === 101 && hasAuthProto) {
    const out = new Response(null, { status: 101, webSocket: res.webSocket });
    out.headers.set("Sec-WebSocket-Protocol", AUTH_SUBPROTOCOL);
    return out;
  }
  return res;
});

export type AppType = typeof app;
export default app;

// The per-document Durable Object must be exported from the Worker entry so the
// runtime can instantiate it for the `DOC_DO` binding (wrangler.toml).
export { DocDO } from "./doc-do";
