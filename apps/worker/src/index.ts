import {
  SYNC_SUBPROTOCOL_V1,
  zCreateFigure,
  zCreateRoutine,
  zFamilyNoteBody,
  zFigureRefBody,
  zInterpretVoiceNote,
  zIssueInvite,
  zProfileBody,
  zRegistryKind,
  zSaveToLibrary,
} from "@weavesteps/contract";
import {
  type ChoreoContext,
  CURRENT_SCHEMA_VERSION,
  can,
  type FigureDoc,
  globalFigureRef,
  isDanceId,
  isReservedKind,
  LIBRARY_FIGURES,
  newId,
  parseAttributeWrite,
  type RoutineDoc,
  serializeChoreoContext,
} from "@weavesteps/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { authenticate, authenticateToken } from "./auth";
import { isAdmin, routineCapFor } from "./db/admin";
import { listAccountKinds, upsertAccountKind } from "./db/custom-kinds";
import { familyNotesForMembers } from "./db/family-notes";
import { createFigureRows, listGlobalFigures, listMineFigures } from "./db/figures";
import { issueInvite, redeemInvite } from "./db/invites";
import { journalForUser } from "./db/journal";
import { listMembers, ownerInfoFor, removeMember, resolveEffectiveRole } from "./db/membership";
import { linkPlacement } from "./db/placement-edge";
import { predicateNotesForMembers } from "./db/predicate-notes";
import {
  countOwnedRoutines,
  createOwnedRoutine,
  FREE_ROUTINE_CAP,
  getDocOwner,
  listRoutines,
  listTemplates,
  searchReachable,
  softDeleteRoutine,
} from "./db/routines";
import { userNameCache, users } from "./db/schema";
import type { DocDO } from "./doc-do";
import { accountDocRef, ensureAccountDoc } from "./ensure-account-doc";
import { readFigureSnapshot } from "./figure-snapshot";
import { forkRoutineFor } from "./fork";
import { reportError, writeMetric } from "./ops";
import { testSeed } from "./routes/test-seed";
import { seedSampleRoutine } from "./sample";
import { ensureGlobalFigures } from "./seed-global-figures";
import { seedStarterRoutine } from "./starter";
import { groundProposal, voiceAiFor } from "./voice-ai";

// Lazily ensure the app-owned sample template exists, self-healing on ACTUAL D1
// state (not a stale module boolean). A cheap indexed existence check (ownerId
// ='app' via owner_idx) short-circuits in prod once the row persists, and
// re-seeds if the row is ever gone (e.g. the E2E /api/test/reset wipes D1 — a
// boolean guard would leave templates permanently empty after a reset).
// seedSampleRoutine is idempotent, so a concurrent re-seed race is safe.
async function ensureSample(env: Env): Promise<void> {
  try {
    const existing = await listTemplates(env.DB);
    if (existing.length > 0) return;
    await seedSampleRoutine(env);
  } catch (err) {
    console.error("sample seed failed", err);
  }
}

export type Env = {
  DB: D1Database;
  // Per-document Automerge host (US-014, docs/system/architecture.md
  // § Persistence & the DO lifecycle): one DO per routine/figure
  // document, SQLite-backed, the sync + permission boundary. Typed with the DO
  // class so the create routes can call its RPC (seedDoc, #205).
  DOC_DO: DurableObjectNamespace<DocDO>;
  // Clerk verification keys — set as Wrangler secrets (see PROVISIONING.md).
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
  // "1" ONLY in the E2E wrangler run (wrangler.toml [env.e2e]); mounts the
  // /api/test/* fixtures routes. Unset everywhere else → those routes 404.
  E2E_TEST_ROUTES?: string;
  // "1" on deployed envs (wrangler.toml [env.*.vars]): arms the self-healing
  // catalog reconcile on the /api/* seam (D30 ⟳). Unset in unit/E2E harnesses.
  SELF_SEED?: string;
  // US-049 (M8) observability — both optional so dev/test run with neither:
  // errors→Sentry (a Wrangler secret; see ops.ts) and product metrics→the
  // Analytics Engine dataset bound in wrangler.toml.
  SENTRY_DSN?: string;
  ANALYTICS?: AnalyticsEngineDataset;
  // The deploy's build id (the git SHA, injected by deploy.yml via
  // `wrangler deploy --var`). /api/health exposes it so a running tab can tell
  // its bundle is stale and reload (apps/web/src/lib/stale-bundle.ts) — the
  // mechanism that closes the open-tab version-skew window after a rollout.
  // Unset in dev/test → health reports null and clients never force a reload.
  BUILD_ID?: string;
  // AI voice notes (docs/ideas/ai-voice-notes.md; docs/TOOLING.md § AI voice
  // notes) — the Workers AI binding (STT fallback + extraction) and the AI
  // Gateway id. Both DEPLOYED-ENVS-ONLY (wrangler.toml [env.staging|production]),
  // both optional so dev + vitest-pool-workers + [env.e2e] run with NEITHER —
  // `voiceAiFor` then selects the deterministic fixture, keeping the zero-secret
  // test matrix. Same optional-binding pattern as ANALYTICS.
  AI?: Ai;
  AI_GATEWAY_ID?: string;
};

const app = new Hono<{ Bindings: Env }>();

// The request URL WITHOUT its query string — for error reporting. `c.req.url`
// carries the raw query (e.g. `/api/search?q=<user text>`), which is user content
// / potential PII; we never forward it to a third party (Sentry). Origin + path
// only.
// A JSON object with string keys — the shape a request body narrows to before we
// read fields off it. Type guard (never a cast) so field access stays `unknown`.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function safeReportUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.search = "";
    return u.toString();
  } catch {
    return rawUrl.split("?")[0] ?? rawUrl;
  }
}

// Defense-in-depth response headers on every worker response (the /api/* + WS
// surface). The SPA HTML is served by the assets binding, NOT the worker, so its
// headers live in apps/web/public/_headers; these cover what the worker itself
// returns. No Content-Security-Policy here — a CSP has to be validated against
// Clerk / Sentry / the Automerge WASM loader and is a separate, owner-gated
// change; these three are safe, non-breaking, standard hardening.
app.use("*", async (c, next) => {
  await next();
  // A 101 WebSocket-upgrade response carries immutable headers — never touch it.
  if (c.res.status === 101) return;
  try {
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  } catch {
    // Some responses expose immutable headers (streamed/cached) — skip them.
  }
});

// US-049 AC-1: unhandled route errors are reported to Sentry (fire-and-forget —
// waitUntil so the 500 isn't held up) and the client gets a structured 500.
app.onError((err, c) => {
  const url = safeReportUrl(c.req.url);
  try {
    c.executionCtx.waitUntil(reportError(c.env, err, { url, method: c.req.method }));
  } catch {
    // No execution context (some test harnesses): report best-effort instead.
    void reportError(c.env, err, { url, method: c.req.method });
  }
  console.error("unhandled route error", err);
  return c.json({ error: "internal" }, 500);
});

// D30 ⟳ (self-healing catalog): keep the global figure docs reconciled to the
// bundled seed — fire-and-forget, hash-guarded (one PK SELECT per throttle
// window per isolate), so a deploy with refined seed content reaches every
// already-seeded doc within seconds of the first request, and a fresh
// environment stands its catalog up on its own. Explicitly OPT-IN per deployed
// environment (wrangler.toml `SELF_SEED="1"` on staging/production): the unit
// harness and the E2E env carry no var, so nothing implicitly seeds the full
// catalog under a test — the E2E /api/test/seed fixtures drive it explicitly.
app.use("/api/*", async (c, next) => {
  if (c.env.SELF_SEED === "1") {
    try {
      c.executionCtx.waitUntil(ensureGlobalFigures(c.env));
    } catch {
      // No execution context (some unit harnesses) — the next request retries.
    }
  }
  await next();
});

// US-049 AC-1: one product metric per API request (method, route, status,
// duration). writeMetric is a no-op without the AE binding and never throws.
app.use("/api/*", async (c, next) => {
  const t0 = Date.now();
  await next();
  writeMetric(c.env.ANALYTICS, {
    name: "api_request",
    blobs: [c.req.method, new URL(c.req.url).pathname, String(c.res.status)],
    doubles: [Date.now() - t0],
  });
});

// buildId is the stale-bundle handshake (always present, null when not a real
// deploy): the SPA compares it against its own baked-in VITE_BUILD_ID and
// reloads onto the new bundle on mismatch — see apps/web/src/lib/stale-bundle.ts.
//
// clerkConfigured / sentryConfigured are provisioning diagnostics (US-049,
// 2026-07-05 incident): a deployed env with missing or mismatched secrets fails
// closed AND silently — every API call 401s and nothing reports. These booleans
// only say whether the secrets are SET (never their values), so a provisioning
// gap is one `curl /api/health` away instead of a production mystery.
app.get("/api/health", (c) =>
  c.json({
    ok: true,
    buildId: c.env.BUILD_ID ?? null,
    clerkConfigured: Boolean(c.env.CLERK_SECRET_KEY || c.env.CLERK_JWT_KEY),
    sentryConfigured: Boolean(c.env.SENTRY_DSN),
  }),
);

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
  // Cache a human label from this user's Clerk claims so co-members can resolve it
  // (even before this user onboards — they have no `users` row yet): their real
  // name when the token carries one, else their email — anything better than the
  // raw `user_…` id. Best-effort: a cache write must never fail /api/me. See
  // migration 0013.
  const cacheLabel = user.name ?? user.email;
  if (cacheLabel) {
    try {
      const now = Date.now();
      await db
        .insert(userNameCache)
        .values({ id: user.sub, name: cacheLabel, updatedAt: now })
        .onConflictDoUpdate({
          target: userNameCache.id,
          set: { name: cacheLabel, updatedAt: now },
        });
    } catch (err) {
      console.error("user name cache write failed", { userId: user.sub, err });
    }
  }
  const row = await db.select().from(users).where(eq(users.id, user.sub)).get();
  // Not onboarded: still surface the Clerk-derived name — or, failing that, the
  // email — so the client shows something human instead of the raw user id until
  // they set a profile.
  if (!row)
    return c.json({
      sub: user.sub,
      onboarded: false,
      displayName: user.name ?? user.email,
      routineCap: FREE_ROUTINE_CAP,
    });
  return c.json({
    sub: user.sub,
    onboarded: true,
    displayName: row.displayName,
    identityColor: row.identityColor,
    plan: row.plan,
    // The owned-routine cap the client gates the upsell on — the admin-granted
    // per-user override (D31) when set, else the ONE server constant (#176). The
    // POST /api/routines 402 enforces the SAME value via routineCapFor.
    routineCap: row.routineCapOverride ?? FREE_ROUTINE_CAP,
    // D31: expose the admin flag so the profile/admin surfaces can gate on it.
    isAdmin: row.isAdmin,
  });
});

// POST /api/onboarding — capture the account's displayName + identity color
// (US-019 AC-2). Upsert keyed by the verified Clerk sub, so re-running it is
// idempotent (e.g. a retried first-run). Plan defaults to 'free' (billing is
// US-053/quota). A hex identityColor keeps annotation authorship legible (#5).
app.post("/api/onboarding", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const parsed = zProfileBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_profile" }, 400);
  const { displayName, identityColor } = parsed.data;

  const db = drizzle(c.env.DB);
  // Detect a genuine first onboarding (no prior users row) so the starter routine
  // is seeded at most once — a re-onboard / profile edit hits the update path.
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, user.sub))
    .get();
  const firstRun = !existing;

  await db
    .insert(users)
    .values({ id: user.sub, displayName, identityColor, plan: "free", createdAt: Date.now() })
    .onConflictDoUpdate({ target: users.id, set: { displayName, identityColor } });

  if (firstRun) {
    // Best-effort: a new user gets a default "Golden Waltz Basic" routine (US-055).
    // Never fail onboarding if the gift can't be seeded — the account must succeed.
    try {
      await seedStarterRoutine(c.env, user.sub);
    } catch (err) {
      console.error("starter routine seed failed", { userId: user.sub, err });
    }
  }

  return c.json({ sub: user.sub, displayName, identityColor, plan: "free" });
});

// GET /api/profile — plan status + owned-routine count for the Profile screen
// (US-053 AC-2). 404s for a not-yet-onboarded user (no users row) — the client
// routes into onboarding on that.
app.get("/api/profile", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const db = drizzle(c.env.DB);
  const row = await db.select().from(users).where(eq(users.id, user.sub)).get();
  if (!row) return c.json({ error: "not_onboarded" }, 404);
  const ownedRoutineCount = await countOwnedRoutines(c.env.DB, user.sub);
  return c.json({
    plan: row.plan,
    ownedRoutineCount,
    displayName: row.displayName,
    identityColor: row.identityColor,
    routineCap: row.routineCapOverride ?? FREE_ROUTINE_CAP,
    isAdmin: row.isAdmin,
  });
});

// PATCH /api/profile — edit displayName + identity colour (US-053 AC-1). Same
// validation as onboarding (the two write the same columns); PATCH never seeds
// the starter and 404s when there is no users row to edit.
app.patch("/api/profile", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const parsed = zProfileBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_profile" }, 400);
  const { displayName, identityColor } = parsed.data;
  const db = drizzle(c.env.DB);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, user.sub))
    .get();
  if (!existing) return c.json({ error: "not_onboarded" }, 404);
  await db.update(users).set({ displayName, identityColor }).where(eq(users.id, user.sub));
  return c.json({ sub: user.sub, displayName, identityColor });
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

  // SERVER-SIDE quota (D21/D31): the cap honours a per-user `routineCapOverride`
  // (an admin grant) BEFORE the plan default (routineCapFor); pro is unbounded.
  // Only OWNED routines count (shared-in membership rows don't). Enforced here so
  // a client bypass is still blocked.
  const { plan, cap } = await routineCapFor(c.env.DB, user.sub);
  const owned = await countOwnedRoutines(c.env.DB, user.sub);
  if (owned >= cap) {
    return c.json({ upsell: true, reason: "quota", cap, owned, plan }, 402);
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
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deletedAt: null,
  });
  return c.json({ docRef, title, dance, plan }, 201);
});

// POST /api/routines/:id/fork — choreo fork, "make it your own" (US-037). Any
// MEMBER of the origin (resolveEffectiveRole non-null; non-member 403) may fork
// it into a NEW owned routine. App-owned templates (ownerId="app") may also be
// forked by any authenticated user without a membership row (US-045/Task 6).
// The fork is INDEPENDENT of its ORIGIN (v5, docs/concepts/choreography.md
// § Forking, docs/concepts/figures.md § Variants, D12): we snapshot
// the origin's CRDT content and seed a brand-new doc with it (no shared
// history), so later origin STRUCTURAL edits never appear in the fork, AND we
// copy every referenced ACCOUNT figure for the forker (a variant copied as a
// variant — catalog flow-in continues) so a later edit to the origin's account
// figures doesn't leak into the fork either (forkRoutineFor). GLOBAL (catalog)
// figure refs stay LIVE — the fork keeps receiving catalog improvements like
// every other routine. `forkedFromRef` records the routine's lineage
// (provenance only — no pull). A fork COUNTS against the forker's quota.
app.post("/api/routines/:id/fork", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const originRef = c.req.param("id");

  // Fast PK lookup — tells us if this is an app-owned template before any heavy work.
  const owner = await getDocOwner(c.env.DB, originRef);

  // Only app-template forks need the seed: user-routine forks never call getSnapshot
  // on an app-owned DO, so the extra existence check is wasteful on every user fork.
  if (owner === "app") {
    // Ensure the app template DO content exists before getSnapshot is called inside
    // forkRoutineFor (idempotent; re-seeds if the E2E reset wiped D1).
    await ensureSample(c.env);
  }

  // Must be able to read the origin to fork it (member/owner — or app-owned template).
  const role = await resolveEffectiveRole(c.env.DB, originRef, user.sub);
  if (!role && owner !== "app") return c.json({ error: "forbidden" }, 403);

  // forkRoutineFor resolves the plan itself and returns it (in both the success
  // and upsell shapes), so the route doesn't re-query users.plan here.
  const result = await forkRoutineFor(c.env, { originRef, userId: user.sub });
  if ("upsell" in result) {
    return c.json({ ...result, reason: "quota" }, 402);
  }
  return c.json(result, 201);
});

// DELETE /api/routines/:id — delete a routine from the Choreo overview (US-025
// delete flow). DELETE is OWNER-ONLY (docs/concepts/collaboration.md: only the owner can delete the
// doc — `canDelete`). Ownership is the registry `ownerId`, NOT the effective role:
// an owner carries an EDITOR membership row (createOwnedRoutine, #168), so
// resolveEffectiveRole would resolve them to "editor" and never "owner" — gating
// on that would lock the real owner out. So we compare ownerId to the verified
// sub. A non-owner member (editor/commenter/viewer) or non-member → 403; an
// unknown routine → 404. Soft-delete only: the registry row is tombstoned
// (deletedAt), never hard-removed (docs/system/architecture.md § Global constraints), so the routine drops out of the
// list/count/search while its CRDT doc and shared-in members' history survive.
// A re-delete (already tombstoned) matches zero rows → 404.
app.delete("/api/routines/:id", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const docRef = c.req.param("id");
  const owner = await getDocOwner(c.env.DB, docRef);
  if (owner === null) return c.json({ error: "not_found" }, 404);
  if (owner !== user.sub) return c.json({ error: "forbidden" }, 403);
  const removed = await softDeleteRoutine(c.env.DB, docRef);
  if (removed === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true }, 200);
});

// GET /api/figures?dance= — the global figure library list (US-032), from the
// D1 index (no CRDT scan). Open to any authenticated user.
app.get("/api/figures", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const dance = c.req.query("dance") || undefined;
  const figures = await listGlobalFigures(c.env.DB, dance);
  return c.json({ figures });
});

// GET /api/figures/mine — the caller's account variants + custom figures with a
// "used in N routines" count (US-033), from the D1 index.
app.get("/api/figures/mine", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const figures = await listMineFigures(c.env.DB, user.sub);
  return c.json({ figures });
});

// POST /api/figures — project a client-minted figure doc to the D1 index (#187).
// The client mints the figureRef + metadata; the SERVER stamps ownerId from the
// verified JWT (never a client field). Projecting the registry row + owner
// membership is what lets the fail-closed DO boundary (US-021) owner-resolve a
// connect to that figure (101, not 403). Idempotent on figureRef. Figures are
// NOT counted against the routine quota (type="account-figure" ≠ "routine").
app.post("/api/figures", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const parsed = zCreateFigure.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_figure", issues: parsed.error.flatten() }, 400);
  }
  const { figureRef, name, dance, figureType, routineId, attributes, counts, bars, baseFigureRef } =
    parsed.data;

  // Strict write-validate every seeded attribute (count on the 1/8 grid ≥ 1,
  // known-enum kinds in range) so the catalog/seed can't inject bad timeline data.
  try {
    for (const a of attributes) parseAttributeWrite(a, { dance });
  } catch {
    // Don't echo attacker-shaped attribute data back at the seed boundary — just reject.
    return c.json({ error: "invalid_attribute" }, 400);
  }

  // AUTHZ (2026-07-02 review): creating a figure binds it to `routineId` — the
  // placement edge feeds the role CASCADE, so linking a figure into a routine
  // grants that routine's editors edit rights on it. The caller must therefore
  // be able to EDIT the routine; without this check any authenticated user could
  // link a victim's figureRef into their own routine and cascade themselves to
  // editor on it.
  const routineRole = await resolveEffectiveRole(c.env.DB, routineId, user.sub);
  if (routineRole !== "editor" && routineRole !== "owner") {
    return c.json({ error: "forbidden" }, 403);
  }

  const created = await createFigureRows(c.env.DB, {
    figureRef,
    ownerId: user.sub,
    name,
    dance,
    figureType,
    baseFigureRef,
  });
  // A figureRef that already belongs to someone else is rejected outright —
  // no registry rewrite, no membership, no placement edge, no seed (see
  // createFigureRows' authz note).
  if (created === "owner_conflict") {
    return c.json({ error: "figure_ref_conflict" }, 409);
  }
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
    attributes,
    // The authored COUNT length (Builder v3 ① — beats; bar displays derive
    // ⌈counts / beatsPerBar⌉). A legacy client may still send `bars`; counts
    // wins when both arrive. Omitted → the DO falls back to the whole-beat
    // default when projecting the card count.
    ...(counts != null ? { counts } : bars != null ? { bars } : {}),
    // The client-forwarded attributes are stored RAW — a ⟳v5 variant carries only
    // its OWNED beats; overlay resolution against the live `baseFigureRef` happens
    // CLIENT-side (§5.2). The worker never resolves; it persists what it's given.
    ...(baseFigureRef ? { baseFigureRef } : {}),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deletedAt: null,
  });
  return c.json({ figureRef, name, dance, figureType, ownerId: user.sub }, 201);
});

// POST /api/figures/save-to-library — "↟ Save to my library" (T5; ⟳v5 — a
// BOOKMARK, never a copy, docs/concepts/figures.md § The library screen / § Variants, D28). Records `figureRef` in the
// CALLER'S `library_entry` projection (+ their account doc, once it is wired to
// a live DO — see doc-account.ts's STORAGE NOTE). Supersedes the v4.x
// frozen-copy promotion: no figure doc is minted or seeded here.
//
// AUTHZ: you can't bookmark a doc you can't read. A catalog ref (`global:*`) is
// readable by every signed-in user by construction; an account-figure ref
// requires `resolveEffectiveRole` to resolve non-null (owner/member, OR the
// routine-cascade a co-member gets via a shared routine's placements, §5.1) —
// so a bare figureRef leaked from elsewhere can't be bookmarked blind.
//
// Idempotent per (caller, figureRef): re-saving returns `alreadySaved: true`,
// always 200 (no distinct "created" status — a bookmark has no id of its own to
// report back).
app.post("/api/figures/save-to-library", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const parsed = zSaveToLibrary.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_save", issues: parsed.error.flatten() }, 400);
  }

  // Resolve the figureRef to bookmark: the v5 direct shape names it; the legacy
  // (dance, figureType, name) triple is resolved SERVER-SIDE against the bundled
  // catalog (never trusting client-supplied identity) to `globalFigureRef` — the
  // catalog doc itself is bookmarked, no copy minted.
  let figureRef: string;
  if ("figureRef" in parsed.data) {
    figureRef = parsed.data.figureRef;
  } else {
    const { dance, figureType, name } = parsed.data;
    const origin = LIBRARY_FIGURES.find(
      (f) => f.dance === dance && f.figureType === figureType && f.name === name,
    );
    if (!origin) return c.json({ error: "unknown_figure" }, 404);
    figureRef = globalFigureRef(dance, figureType);
  }

  if (!figureRef.startsWith("global:")) {
    const role = await resolveEffectiveRole(c.env.DB, figureRef, user.sub);
    if (role == null) return c.json({ error: "forbidden" }, 403);
  }

  // WEP-0002 (docs/system/architecture.md § D1 — the index & projections): write THROUGH the account DO — the canonical bookmark set lives in
  // the account doc's `libraryFigureRefs`; the DO alarm is the single writer of
  // the `library_entry` D1 projection. A re-add is an idempotent no-op, so the
  // v1 `{ alreadySaved }` shape is derived from whether the edit changed the doc.
  await ensureAccountDoc(c.env, user.sub);
  const r = await c.env.DOC_DO.get(
    c.env.DOC_DO.idFromName(accountDocRef(user.sub)),
  ).applyAccountEdit({ op: "addLibraryRef", figureRef });
  return c.json({ alreadySaved: !r.changed }, 200);
});

// DELETE /api/figures/save-to-library — un-bookmark (⟳v5). Body-based (not a
// path param) because a bookmarked figureRef can itself contain `/` (an
// Automerge URL) or `:` (a catalog `global:<dance>:<figureType>` ref), which a
// path segment would need lossy encoding for. Tombstones the LibraryEntry ONLY
// — never the figure doc or its placements (§5.2). Idempotent: un-bookmarking an
// absent/already-removed entry still 200s (no distinct "not found").
app.delete("/api/figures/save-to-library", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const parsed = zFigureRefBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
  const { figureRef } = parsed.data;
  // WEP-0002 (docs/system/architecture.md § D1 — the index & projections): un-bookmark THROUGH the account DO (the alarm tombstones the
  // `library_entry` row). Idempotent — removing an absent ref is a no-op — so
  // this still 200s regardless of whether the doc changed.
  await ensureAccountDoc(c.env, user.sub);
  await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(accountDocRef(user.sub))).applyAccountEdit({
    op: "removeLibraryRef",
    figureRef,
  });
  return c.json({ ok: true }, 200);
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
  const reg = await c.env.DB.prepare(
    "SELECT dance, ownerId FROM document_registry WHERE docRef = ?",
  )
    .bind(routineRef)
    .first<{ dance: string | null; ownerId: string | null }>();
  const dance = reg?.dance ?? "waltz";

  // The author set is the routine's members PLUS its owner — a routine owner is
  // elevated by resolveEffectiveRole WITHOUT a membership row (#168), so without
  // this the owner's OWN figureType notes would never surface on their own routine
  // (the reported bug). Deduped; symmetric with journalForUser's owner arm.
  const members = await listMembers(c.env.DB, routineRef);
  const authorIds = [
    ...new Set([...members.map((m) => m.userId), ...(reg?.ownerId ? [reg.ownerId] : [])]),
  ];
  const rows = await familyNotesForMembers(c.env.DB, authorIds, dance);
  // Shape each row as an Annotation-like note (with a figureType anchor) so the
  // client can match it to the routine's figures (resolveFamilyNotesFor). A
  // TIMED note (WEP-0004 — docs/concepts/annotations.md § Anchors) carries count/role on the note AND its anchor so the
  // client can pin it in the figure grid; keys are conditionally spread — an
  // untimed row keeps the exact v1 shape.
  const notes = rows.map((r) => ({
    id: r.noteId,
    authorId: r.authorId,
    kind: r.kind,
    text: r.text,
    figureType: r.figureType,
    danceScope: r.danceScope,
    // Surface the note's timestamp so the reading-view margin orders co-members'
    // notes newest-first (v1 index tracks only updatedAt → it is the createdAt).
    createdAt: r.updatedAt,
    ...(r.count != null ? { count: r.count } : {}),
    ...(r.role != null ? { role: r.role } : {}),
    anchors: [
      {
        type: "figureType",
        figureType: r.figureType,
        danceScope: r.danceScope,
        ...(r.count != null ? { count: r.count } : {}),
        ...(r.role != null ? { role: r.role } : {}),
      },
    ],
  }));
  return c.json({ notes });
});

// GET /api/routines/:id/predicate-notes — the co-member ATTRIBUTE-PREDICATE note read
// (attribute-predicate-anchors). Mirrors the family-note read exactly: surfaces the
// dance-/all-scoped predicate notes authored by THIS routine's members (+ owner), so the
// client can run matchPredicate over the routine's resolved timelines and surface each note
// on its matching steps. The content lives on the attribute_predicate_note_index row, so
// this returns it directly — the client never reads another user's account doc. The
// co-membership gate is the security boundary: a NON-member is refused (403) BEFORE any
// note is read. A 'routine'-scoped note is self-read only — it is never served here (the
// query's scope filter excludes it structurally).
app.get("/api/routines/:id/predicate-notes", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const routineRef = c.req.param("id");

  // Gate on co-membership of the routine: a non-member resolves to null → 403.
  const role = await resolveEffectiveRole(c.env.DB, routineRef, user.sub);
  if (!role) return c.json({ error: "forbidden" }, 403);

  const reg = await c.env.DB.prepare(
    "SELECT dance, ownerId FROM document_registry WHERE docRef = ?",
  )
    .bind(routineRef)
    .first<{ dance: string | null; ownerId: string | null }>();
  const dance = reg?.dance ?? "waltz";

  // Author set = the routine's members PLUS its owner — the owner is elevated by
  // resolveEffectiveRole WITHOUT a membership row (#168), so without this arm the owner's
  // own predicate notes would never surface on their own routine. Deduped.
  const members = await listMembers(c.env.DB, routineRef);
  const authorIds = [
    ...new Set([...members.map((m) => m.userId), ...(reg?.ownerId ? [reg.ownerId] : [])]),
  ];
  const rows = await predicateNotesForMembers(c.env.DB, authorIds, dance);
  // Shape each row as an Annotation-like note carrying an attributePredicate anchor so the
  // client's matchPredicate consumes an Anchor. The row's `scope` is a D1 string — narrow
  // it to a valid anchor scope (a DanceId or 'all'; 'routine' is excluded by the query) and
  // skip a malformed row rather than casting.
  const notes = rows.flatMap((r) => {
    if (!(r.scope === "all" || isDanceId(r.scope))) return [];
    return [
      {
        id: r.noteId,
        authorId: r.authorId,
        kind: r.kind,
        text: r.text,
        attrKind: r.attrKind,
        attrValue: r.attrValue,
        scope: r.scope,
        createdAt: r.updatedAt,
        ...(r.attrRole ? { role: r.attrRole } : {}),
        anchors: [
          {
            type: "attributePredicate",
            kind: r.attrKind,
            value: r.attrValue,
            scope: r.scope,
            ...(r.attrRole ? { role: r.attrRole } : {}),
          },
        ],
      },
    ];
  });
  return c.json({ notes });
});

// POST /api/account/family-notes — author a figure-FAMILY note (US-040). The note
// is owned by the caller (authorId from the verified JWT) and scoped to a figure
// family + dance scope (this dance, or "all"). Server-mediated: the client never
// writes another account's data. Co-members then discover it via the route above.
app.post("/api/account/family-notes", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const parsed = zFamilyNoteBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_family_note" }, 400);
  // count/role are the WEP-0004 (docs/concepts/annotations.md § Anchors) timed-note fields; zFamilyNoteBody has already
  // rejected them with danceScope "all" (counts don't align across dances).
  const { kind, text, figureType, danceScope, count, role } = parsed.data;

  // WEP-0002 (docs/system/architecture.md § D1 — the index & projections): author THROUGH the account DO — the note lands in the account doc's
  // annotations (server-minted id), and the DO alarm is the single writer of the
  // `figure_type_note_index` D1 projection co-members read (US-041). Response
  // shape is unchanged from the direct-insert path; `id` is now the DO-minted id.
  await ensureAccountDoc(c.env, user.sub);
  const r = await c.env.DOC_DO.get(
    c.env.DOC_DO.idFromName(accountDocRef(user.sub)),
  ).applyAccountEdit({
    op: "addFamilyNote",
    authorId: user.sub,
    kind,
    text,
    figureType,
    danceScope,
    ...(count != null ? { count } : {}),
    ...(role != null ? { role } : {}),
  });
  if (r.id == null) return c.json({ error: "family_note_failed" }, 500);
  return c.json(
    {
      id: r.id,
      authorId: user.sub,
      figureType,
      danceScope,
      kind,
      text,
      ...(count != null ? { count } : {}),
      ...(role != null ? { role } : {}),
    },
    201,
  );
});

// GET /api/journal — the signed-in user's cross-routine Journal (T6,
// docs/concepts/annotations.md § Anchors / § The Journal; docs/system/architecture.md
// § D1 — the index & projections). The UNION of routine-scoped lesson/practice annotations (projected
// to journal_entry by the routine DO alarm) and account-scoped figureType
// lesson/practice notes (figure_type_note_index), newest-first, tombstones
// excluded, author display/colour joined. VISIBILITY (T6 LOCKED): both arms are
// gated to the user PLUS their co-members on shared routines — the routine arm by
// routine-accessibility, the account arm by the accessible-AUTHORS set (see
// db/journal.ts). Missing/invalid token → 401 (fail-closed) before any read.
app.get("/api/journal", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const entries = await journalForUser(c.env.DB, user.sub);
  return c.json({ entries });
});

// GET /api/account/custom-kinds — the caller's account-wide custom kinds (US-043).
app.get("/api/account/custom-kinds", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const kinds = await listAccountKinds(c.env.DB, user.sub);
  return c.json({ kinds });
});

// POST /api/account/custom-kinds — create/update a custom kind (US-043).
app.post("/api/account/custom-kinds", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const parsed = zRegistryKind.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: "invalid_kind", issues: parsed.error.flatten() }, 400);
  const kind = parsed.data;
  // Builtins are reserved — a custom kind may never be builtin or collide with one.
  if (kind.builtin || isReservedKind(kind.kind)) return c.json({ error: "reserved_kind" }, 400);
  await upsertAccountKind(c.env.DB, user.sub, kind, Date.now());
  return c.json(kind, 201);
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
//
// QUOTA (US-022 × US-023): the routine-edit cap counts routines the user can
// EDIT. An editor invite to a routine a free user can't already edit would add
// one more, so when they're at the cap we grant COMMENTER instead and flag
// `downgraded` — they still join, just read/comment-only. The client notices.
app.post("/api/invites/:token/redeem", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const db = drizzle(c.env.DB);
  const me = await db.select({ plan: users.plan }).from(users).where(eq(users.id, user.sub)).get();
  const plan = me?.plan ?? "free";

  const result = await redeemInvite(c.env.DB, c.req.param("token"), user.sub, {
    plan,
    editableCap: FREE_ROUTINE_CAP,
  });
  if (!result.ok) {
    if (result.reason === "not_found") return c.json({ error: "invite_not_found" }, 404);
    if (result.reason === "expired") return c.json({ error: "invite_expired" }, 410);
    return c.json({ error: "invite_already_redeemed" }, 409);
  }
  // A role change (e.g. viewer → editor upgrade) reaches the user's OPEN sockets
  // too (§5.1 hardening) — best-effort, next connect enforces regardless. Skipped
  // for an already-member redirect: no role changed, so there's nothing to push.
  if (!result.alreadyMember) {
    try {
      await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(result.docRef)).refreshConnectedRoles();
    } catch (err) {
      console.error("invite redeem: role refresh on open sockets failed", err);
    }
  }
  return c.json(
    {
      docRef: result.docRef,
      role: result.role,
      requestedRole: result.requestedRole,
      downgraded: result.downgraded,
      alreadyMember: result.alreadyMember ?? false,
    },
    200,
  );
});

// GET /api/docs/:id/members — the Share screen's member list (US-024 AC-1). Only
// roles that can manage membership (editor/owner, can(role,"canInvite")) may read
// the roster — the Share button is already hidden from viewer/commenter in the UI,
// and the API enforces the same gate. Returns the membership rows PLUS the doc owner
// (who has no membership row but must appear in the roster).
app.get("/api/docs/:id/members", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const docRef = c.req.param("id");
  const role = await resolveEffectiveRole(c.env.DB, docRef, user.sub);
  if (!role || !can(role, "canInvite")) return c.json({ error: "forbidden" }, 403);
  const [members, owner] = await Promise.all([
    listMembers(c.env.DB, docRef),
    ownerInfoFor(c.env.DB, docRef),
  ]);
  return c.json({ members, owner });
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
  // §5.1 boundary hardening (2026-07-02): revocation must reach OPEN sockets —
  // the removed member's live connection is closed by the DO, not left writable
  // until they happen to reconnect. Best-effort: the membership row is already
  // tombstoned, so a failure here only delays enforcement to the next connect.
  try {
    await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(docRef)).refreshConnectedRoles();
  } catch (err) {
    console.error("member removal: role refresh on open sockets failed", err);
  }
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

// GET /api/routines/:id/snapshot — the READ-ONLY snapshot path (read/edit split).
// A single REST read hydrates a routine + ALL its referenced figures — plus, for
// any figure that is a v5 VARIANT, the live BASE it resolves against — with NO
// per-document WebSocket. Opening a routine to *read* it (the common case) then
// costs one request and zero persistent sockets, instead of one live WS per
// routine + per figure. The live WS sync (US-015) is reserved for the EDIT path.
// Same gate as /access: a non-member 403s (the fail-closed DO boundary, US-021,
// remains the real gate for the WS path).
//   • unauthenticated → 401  • non-member → 403
//   • member/owner → 200 { routine, figures, bases }
//
// ⟳v5 (§5.2): a placed figure with a non-null `baseFigureRef` (a variant) carries
// only its OWNED beats; its untouched beats resolve LIVE from the base. The client
// renders `resolveFigure(base, variant)`, so the snapshot fans out to each
// distinct base (typically a global catalog doc) and returns them in `bases`,
// keyed by ref. A catalog figure placed as a live reference points directly at the
// global doc, so it lands in `figures` and needs no base.
app.get("/api/routines/:id/snapshot", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const routineRef = c.req.param("id");
  const role = await resolveEffectiveRole(c.env.DB, routineRef, user.sub);
  if (!role) return c.json({ error: "forbidden" }, 403);

  const doc = (id: string) => c.env.DOC_DO.get(c.env.DOC_DO.idFromName(id));
  const routine = await doc(routineRef).getSnapshot();

  // Every LIVE placement's figure (tombstoned placements dropped).
  const figureRefs = new Set<string>();
  for (const section of routine.sections ?? []) {
    for (const p of section.placements ?? []) {
      // A break placement carries no figureRef — skip it (US-004a).
      if (p.deletedAt == null && p.figureRef) figureRefs.add(p.figureRef);
    }
  }

  // Fan out figure reads in parallel. A figure's snapshot is its OWN attributes (a
  // variant carries only its owned beats). A never-seeded/empty figure is omitted →
  // the client renders it missing.
  //
  // PER-FIGURE AUTHORIZATION (security): a routine's placements are caller-controlled
  // CRDT content — a caller can add a placement referencing ANY figure docRef they've
  // learned (nothing at the WS/CRDT layer validates the ref against access). So the
  // routine's role does NOT imply the right to read every ref it lists; without a
  // per-figure gate this REST path leaks any figure whose ref an authenticated user
  // can obtain, bypassing the cascade-revocation the WS figure-doc boundary enforces.
  // Gate each ref on the caller's ACTUAL effective role — ownership, global (world-
  // readable), or the placement_edge cascade (a routine they're a member of that
  // legitimately references it) — the same resolver the DO boundary uses, and drop
  // the ones they can't read (rendered missing). Every legitimately-referenced figure
  // has a server-minted placement_edge (POST /api/figures, fork, break-migration), so
  // this never drops a figure a member is entitled to.
  const figures: Record<string, FigureDoc> = {};
  await Promise.all(
    [...figureRefs].map(async (ref) => {
      if (!(await resolveEffectiveRole(c.env.DB, ref, user.sub))) return; // unauthorized → omit
      const fig = await readFigureSnapshot(doc(ref));
      if (!fig?.figureType) return;
      figures[ref] = fig;
    }),
  );

  // Fan out to each distinct BASE a variant resolves against (⟳v5). The client
  // needs the base's live content to fill a variant's untouched beats
  // (`resolveFigure`). Skip a base already present as a placed figure (a routine
  // that places both the catalog figure AND a variant of it), and drop
  // never-seeded bases (a legacy full copy still resolves to itself).
  const baseRefs = new Set<string>();
  for (const fig of Object.values(figures)) {
    if (fig.baseFigureRef && !figures[fig.baseFigureRef]) baseRefs.add(fig.baseFigureRef);
  }
  // Bases are gated the same way (a base is typically a world-readable global
  // catalog doc; the gate returns `viewer` for those, so legitimate bases are never
  // dropped, while an unreadable base a caller isn't entitled to is omitted).
  const bases: Record<string, FigureDoc> = {};
  await Promise.all(
    [...baseRefs].map(async (ref) => {
      if (!(await resolveEffectiveRole(c.env.DB, ref, user.sub))) return; // unauthorized → omit
      const base = await readFigureSnapshot(doc(ref));
      if (!base?.figureType) return;
      bases[ref] = base;
    }),
  );

  return c.json({ routine, figures, bases });
});

// ── AI voice notes (docs/concepts/annotations.md § The Journal, docs/system/
// architecture.md) — the READ-ONLY interpret/transcribe routes. A dancer speaks a
// note; a Workers AI text model resolves it against the figures ACTUALLY in the
// caller's choreos into a PROPOSED anchor; the client confirms and it commits
// through the EXISTING annotation seams. These routes NEVER write D1, a DO, or the
// CRDT — the AI stays entirely outside the permission/CRDT boundary.
//
// The Workers AI binding (`AI`) exists only in deployed wrangler envs; dev, unit
// tests, and E2E run the deterministic fixture seam (`voiceAiFor`), so the
// zero-secret test matrix holds. Every model output is re-validated with Zod AND
// grounded against the assembled context (`groundProposal`) — never trusted.

/**
 * Assemble the caller's in-scope choreography for grounding — the SAME per-figure
 * authorization the snapshot route uses (a routine's placements are
 * caller-controlled CRDT content, so the routine's role does NOT imply the right
 * to read every figure ref it lists; gate each ref individually). Scope: one
 * routine when `routineRef` is given (gated by `resolveEffectiveRole`), else the
 * caller's annotate-capable routines (role !== "viewer"). READ-ONLY.
 */
async function assembleVoiceContext(
  env: Env,
  userId: string,
  routineRef: string | undefined,
): Promise<ChoreoContext> {
  const doc = (id: string) => env.DOC_DO.get(env.DOC_DO.idFromName(id));

  // The routine refs in scope, each already confirmed annotate-capable.
  let routineRefs: string[];
  if (routineRef != null) {
    const role = await resolveEffectiveRole(env.DB, routineRef, userId);
    routineRefs = role && role !== "viewer" ? [routineRef] : [];
  } else {
    const listed = await listRoutines(env.DB, userId);
    // Owned routines have role "owner"; shared ones carry their membership role.
    // Mirror store/journal.ts: only annotate-capable (non-viewer) routines.
    routineRefs = listed.filter((r) => r.role !== "viewer").map((r) => r.docRef);
  }

  const entries: {
    routine: RoutineDoc;
    figures: Record<string, FigureDoc>;
    bases: Record<string, FigureDoc>;
  }[] = [];
  for (const ref of routineRefs) {
    const routine = await doc(ref).getSnapshot();
    // Every LIVE placement's figure (tombstoned placements + breaks dropped).
    const figureRefs = new Set<string>();
    for (const section of routine.sections ?? []) {
      for (const p of section.placements ?? []) {
        if (p.deletedAt == null && p.figureRef) figureRefs.add(p.figureRef);
      }
    }
    // PER-FIGURE AUTHORIZATION (security) — identical to the snapshot route: gate
    // every ref on the caller's ACTUAL effective role and drop the ones they
    // can't read (a placement can name any docRef the caller has learned).
    const figures: Record<string, FigureDoc> = {};
    await Promise.all(
      [...figureRefs].map(async (fref) => {
        if (!(await resolveEffectiveRole(env.DB, fref, userId))) return;
        const fig = await readFigureSnapshot(doc(fref));
        if (!fig?.figureType) return;
        figures[fref] = fig;
      }),
    );
    // Fan out to each distinct BASE a variant resolves against (⟳v5), gated the
    // same way — so the serializer folds the live timeline (resolveFigure).
    const baseRefs = new Set<string>();
    for (const fig of Object.values(figures)) {
      if (fig.baseFigureRef && !figures[fig.baseFigureRef]) baseRefs.add(fig.baseFigureRef);
    }
    const bases: Record<string, FigureDoc> = {};
    await Promise.all(
      [...baseRefs].map(async (bref) => {
        if (!(await resolveEffectiveRole(env.DB, bref, userId))) return;
        const base = await readFigureSnapshot(doc(bref));
        if (!base?.figureType) return;
        bases[bref] = base;
      }),
    );
    entries.push({ routine, figures, bases });
  }
  return serializeChoreoContext(entries);
}

// POST /api/voice-notes/interpret — resolve a spoken transcript against the
// caller's choreography into a PROPOSED anchor. READ-ONLY (no D1/DO/CRDT write).
//   • unauthenticated → 401  • malformed body → 400
//   • otherwise → 200 { resolved, noteText, confidence, proposed, alternatives }
// A model/seam failure degrades to the resolved:false fallback, never a 500 with
// a half-trusted body.
app.post("/api/voice-notes/interpret", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const parsed = zInterpretVoiceNote.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_voice_note" }, 400);
  const { transcript, routineRef } = parsed.data;

  const context = await assembleVoiceContext(c.env, user.sub, routineRef);
  try {
    const raw = await voiceAiFor(c.env).interpret(transcript, context);
    return c.json(groundProposal(raw, context, transcript));
  } catch (err) {
    // A seam failure is never a wrong anchor — degrade to transcribe-only.
    void reportError(c.env, err, { url: safeReportUrl(c.req.url), method: c.req.method });
    return c.json({
      resolved: false,
      noteText: transcript,
      confidence: "low",
      proposed: null,
      alternatives: [],
    });
  }
});

// POST /api/voice-notes/transcribe — Whisper-fallback STT for the in-scope clip.
// The audio is NEVER stored (transcribe and discard). READ-ONLY.
//   • unauthenticated → 401  • body > 4 MiB → 413  • otherwise → 200 { transcript }
app.post("/api/voice-notes/transcribe", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  // A ~15 s clip is far below this; a defensive storage/latency bound (a caller
  // can't stream an arbitrarily large body into the STT model).
  if (bytes.byteLength > 4 * 1024 * 1024) return c.json({ error: "audio_too_large" }, 413);
  // Seed the STT with the in-scope figure names (names only) so ballroom jargon
  // transcribes; the context is assembled read-only exactly like /interpret.
  const context = await assembleVoiceContext(
    c.env,
    user.sub,
    c.req.query("routineRef") ?? undefined,
  );
  const initialPrompt = context.choreos.flatMap((ch) => ch.figures.map((f) => f.name)).join(", ");
  const transcript = await voiceAiFor(c.env).transcribe(bytes, { initialPrompt });
  return c.json({ transcript });
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

// GET /api/templates — the app-owned start-from-template sources (US-045). Any
// authenticated user may read them; templates are seeded lazily on first call
// (ensureSample is idempotent). The response mirrors the RoutineListItem shape
// with role:"viewer" (the caller can only read, not edit, app-owned templates).
app.get("/api/templates", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  await ensureSample(c.env);
  const rows = await listTemplates(c.env.DB);
  const templates = rows.map((r) => ({
    docRef: r.docRef,
    title: r.title,
    dance: r.dance,
    role: "viewer" as const,
    updatedAt: r.updatedAt,
  }));
  return c.json({ templates });
});

// GET /api/search — prefix search over the D1 index (US-046). Scoped to the
// caller's reachable docs (owned routines + owned/app-owned figures). Indexed
// (EXPLAIN no-SCAN gate, ops.test). Annotation/content search is v1.1.
// NOTE: shared-in routines (membership, not ownership) are out of v1 search
// scope to keep the query single-index; add a UNION over membership_user_idx later.
app.get("/api/search", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ results: [] });
  const dance = c.req.query("dance") ?? undefined;
  const rows = await searchReachable(c.env.DB, { userId: user.sub, q, dance });
  const results = rows.map((r) => ({
    docRef: r.docRef,
    // Production figures are stored as type="figure" in the DB (createFigureRows).
    // Map to the contract-valid types ("global-figure" / "account-figure") here so
    // the web client's zSearchResults.parse never sees the raw "figure" value and
    // silently empties the results list via a ZodError that .catch swallows.
    // The registry column is a plain TEXT, so the union is established by a
    // RUNTIME check (never asserted): an unexpected stored value falls back to
    // "routine" rather than leaking an invalid type to the client.
    type:
      r.type === "figure"
        ? r.ownerId === "app"
          ? "global-figure"
          : "account-figure"
        : r.type === "global-figure" || r.type === "account-figure"
          ? r.type
          : "routine",
    title: r.title ?? "",
    dance: r.dance,
  }));
  return c.json({ results });
});

// POST /api/admin/docs/:id/restore — OPS disaster-recovery: rewind ONE document
// to a past point using Cloudflare's Durable Object Point-in-Time Recovery
// (PITR). Cloudflare retains ~30 days of the DO's SQLite history automatically,
// so this is a pure RESTORE — no backup job of ours. ADMIN-ONLY (users.isAdmin):
// this is destructive (changes after the recovery point are discarded) and
// operates on ANY document by ref, so it is gated on the platform-admin flag,
// NOT on document membership — a doc owner must not be able to rewind their own
// (or a shared) doc through this seam. Runbook: OPS.md.
//
// PRODUCTION-ONLY behaviour: the bookmark API is a real-Cloudflare capability
// (miniflare has no PITR), so only this route's auth gate + validation are
// unit-tested; the rewind itself is verified against a deployed DO. The DO
// restart (phase 2) intentionally aborts the session, so the phase-2 RPC
// rejects by design — we swallow that and report the recovery point.
//
// Body: { at: <ISO 8601 string> } or { timestamp: <epoch ms> }. The time must be
// in the past; Cloudflare clamps/rejects times outside the retention window.
app.post("/api/admin/docs/:id/restore", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  if (!(await isAdmin(c.env.DB, user.sub))) return c.json({ error: "forbidden" }, 403);

  const docRef = c.req.param("id");
  const body: unknown = await c.req.json().catch(() => null);
  // Narrow via a type guard (not a cast): `{ at }` and `{ timestamp }` fields read
  // as `unknown`, then typeof-checked below — no claim the compiler can't verify.
  const at = isRecord(body) ? body.at : undefined;
  const ts = isRecord(body) ? body.timestamp : undefined;
  const timestamp =
    typeof ts === "number" ? ts : typeof at === "string" ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    return c.json({ error: "provide { at: ISO-8601 } or { timestamp: epoch-ms }" }, 400);
  }
  if (timestamp > Date.now()) return c.json({ error: "recovery point must be in the past" }, 400);

  const stub = c.env.DOC_DO.get(c.env.DOC_DO.idFromName(docRef));
  // Phase 1: resolve + arm the bookmark (returns cleanly so we can report it).
  const { bookmark } = await stub.prepareRestore(timestamp);
  // Phase 2: restart the DO to apply it. abort() rejects this RPC by design, so a
  // rejection here means the restart is underway — expected, not an error.
  await stub.commitRestore().catch(() => {});
  return c.json({ ok: true, docRef, restoredTo: new Date(timestamp).toISOString(), bookmark }, 200);
});

// Public WebSocket sync entrypoint for a document (US-017 Phase 1). Routes a
// `GET /api/docs/:id/connect` upgrade to that document's DO (one DO per
// document, keyed by `:id` via idFromName) and forwards the upgrade so the DO's
// Hibernatable-WS sync (US-015) takes over. We pass the doc name to the DO via
// the `x-doc-name` header because the DO can't recover its idFromName key from
// `ctx.id` (US-016).
//
// Lives under `/api/` like every other worker endpoint (moved from the bare
// `/docs/:id/connect` right after launch, while a breaking route change was
// still cheap): the worker+SPA share one origin with `run_worker_first =
// ["/api/*"]`, so a route OUTSIDE `/api/` would permanently reserve a root URL
// namespace (`/docs/*` — exactly where a docs/help site would want to live)
// and couldn't be reclaimed later without stranding old tabs' reconnects.
//
// AUTH (#189): a browser WS handshake can't set an Authorization header, so the
// client offers the Clerk token as a `Sec-WebSocket-Protocol` subprotocol
// (`ballroom.auth, <token>[, ballroom.sync.v1]`). This route extracts the token
// and forwards it to the DO as `Authorization: Bearer …` (worker→DO fetch CAN
// set headers). The DO's US-021 fail-closed boundary then authenticates it
// UNCHANGED — this route only delivers the token, it does not re-authorize. On
// a 101 we echo ONE selected subprotocol (browsers fail the handshake unless
// the server selects one offered): the sync-version subprotocol when the client
// offered it — making the negotiated wire version visible to both peers
// (`ws.protocol` client-side) — else the auth carrier, for pre-v1 clients.
const AUTH_SUBPROTOCOL = "ballroom.auth";

app.get("/api/docs/:id/connect", async (c) => {
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
  // The token is the one offered entry that is NOT a known protocol name —
  // every future `ballroom.*` protocol constant must be excluded here too, or
  // it gets forwarded as the bearer token and auth fail-closes.
  const token = hasAuthProto
    ? offered.find((p) => p !== AUTH_SUBPROTOCOL && p !== SYNC_SUBPROTOCOL_V1)
    : undefined;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // WEP-0002 (docs/system/architecture.md § D1 — the index & projections): an account doc is minted on its owner's FIRST connect. Ensure it
  // exists (seeded + registered) BEFORE forwarding, so the owner boundary resolves
  // (resolveEffectiveRole needs the registry row) and the first connect finds real
  // content. Gated on the authenticated user OWNING this ref — a forged connect to
  // someone else's, or a junk, `account:*` ref never mints a doc; it just 403s at
  // the DO boundary.
  if (id.startsWith("account:") && token) {
    const user = await authenticateToken(`Bearer ${token}`, c.env);
    if (user && id === accountDocRef(user.sub)) {
      await ensureAccountDoc(c.env, user.sub);
    }
  }

  const res = await stub.fetch(new Request(c.req.raw.url, { headers, method: "GET" }));

  // Echo ONE selected subprotocol on a successful upgrade so the browser
  // completes the handshake (it requires the server to select one of the
  // offered protocols). Prefer the sync-version subprotocol when offered — the
  // client reads the negotiated wire version back from `ws.protocol` — and fall
  // back to the auth carrier for a pre-v1 client.
  if (res.status === 101 && hasAuthProto) {
    const selected = offered.includes(SYNC_SUBPROTOCOL_V1) ? SYNC_SUBPROTOCOL_V1 : AUTH_SUBPROTOCOL;
    const out = new Response(null, { status: 101, webSocket: res.webSocket });
    out.headers.set("Sec-WebSocket-Protocol", selected);
    return out;
  }
  return res;
});

export type AppType = typeof app;
export default app;

// The per-document Durable Object must be exported from the Worker entry so the
// runtime can instantiate it for the `DOC_DO` binding (wrangler.toml).
export { DocDO } from "./doc-do";
