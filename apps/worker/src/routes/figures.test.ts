import { env, runInDurableObject, SELF } from "cloudflare:test";
import * as A from "@automerge/automerge";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { uniqueDocName } from "../test-support/do-id";
import type { DocNamespace } from "../test-support/doc-do-api";
import { expectIndexedQuery } from "../test-support/explain";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// WDSF attr-seed — validate + seed forwarded figure attributes on POST /api/figures.
//
// Task 6: the route must strict-validate every forwarded attribute via
// parseAttributeWrite before seeding, and pass the real attributes array into
// seedDoc (not the previous hardcoded []). Off-grid counts (e.g. count: 0.5)
// must be rejected 400 BEFORE any seeding.
// ─────────────────────────────────────────────────────────────────────────

/** Seed a routine OWNED by `userId` and return its ref — POST /api/figures
 *  requires edit rights on `routineId` (2026-07-02 authz: the placement edge
 *  feeds the role cascade, so figure-create is gated on the routine). */
async function seedOwnedRoutine(userId: string): Promise<string> {
  const rt = uniqueDocName("rt");
  await seedDb({ docs: [{ docRef: rt, type: "routine", ownerId: userId, doName: rt }] });
  return rt;
}

describe("WDSF attr-seed: figure attribute forwarding + validation", () => {
  let kp2: TestKeypair;
  const docs2 = env.DOC_DO as unknown as DocNamespace;

  beforeAll(async () => {
    await applyMigrations();
    kp2 = await generateTestKeypair();
  });

  it("seeds forwarded attributes into the figure DO", async () => {
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({
      keypair: kp2,
      userId: "u_attr",
      docRef: figureRef,
      role: null,
    });
    await seedDb({
      users: [{ id: "u_attr", displayName: "A", identityColor: "#111", plan: "free" }],
    });
    const rtAttr = await seedOwnedRoutine("u_attr");

    const res = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Natural Turn",
        dance: "waltz",
        figureType: "natural-turn",
        routineId: rtAttr,
        attributes: [
          {
            id: "wdsf-natural-turn-waltz-s1",
            kind: "step",
            count: 1,
            role: null,
            value: "RF fwd",
            deletedAt: null,
          },
        ],
      }),
    });
    expect(res.status).toBe(201);

    // Assert that the DO was seeded with the real attributes (not an empty array).
    // Figure docs don't have `sections`, so we can't use getSnapshot() (which calls readRoutine
    // and crashes on figure docs). Instead, use runInDurableObject to read the raw Automerge
    // doc content directly from the DO's SQLite change log and decode it.
    const stub = docs2.get(docs2.idFromName(figureRef));
    const attrCount = await runInDurableObject(
      stub as unknown as DurableObjectStub<import("../doc-do").DocDO>,
      async (instance) => {
        // Access ctx via a type assertion — ctx is protected on DurableObject but
        // accessible at runtime; the cast is safe in this test-only context.
        const doState = (instance as unknown as { ctx: DurableObjectState }).ctx;
        const rows = doState.storage.sql
          .exec("SELECT data FROM changes ORDER BY seq")
          .toArray() as Array<{ data: ArrayBuffer }>;
        if (rows.length === 0) return 0;
        // Replay changes to reconstruct the Automerge doc and count attributes.
        let doc = A.init<Record<string, unknown>>();
        const changes = rows.map((r) => new Uint8Array(r.data) as A.Change);
        [doc] = A.applyChanges(doc, changes);
        const plain = A.toJS(doc) as Record<string, unknown>;
        const attrs = plain.attributes as Array<unknown> | undefined;
        return attrs?.length ?? 0;
      },
    );
    expect(attrCount).toBe(1);
  });

  it("rejects an attribute off the timing grid (count: 0.5) with 400", async () => {
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({
      keypair: kp2,
      userId: "u_bad",
      docRef: figureRef,
      role: null,
    });
    await seedDb({
      users: [{ id: "u_bad", displayName: "B", identityColor: "#111", plan: "free" }],
    });

    const res = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "X",
        dance: "waltz",
        figureType: "x",
        routineId: "rt_test",
        attributes: [
          { id: "a1", kind: "step", count: 0.5, role: null, value: "x", deletedAt: null },
        ],
      }),
    });
    expect(res.status).toBe(400);

    // The DO must NOT have been seeded — validation failed before seedDoc was called.
    const stub = docs2.get(docs2.idFromName(figureRef));
    const changeRows = await stub.debugChangeRowCount();
    expect(changeRows).toBe(0);
  });

  it("rejects a kind that doesn't apply to the figure's dance (rise on Tango) with 400 (T9a)", async () => {
    // The DO write boundary enforces the §3/§10.2 dance gate: `rise` omits Tango
    // (appliesToDances), so seeding a rise attribute onto a Tango figure is rejected
    // BEFORE any seedDoc — the write-path analog of the reading view hiding the column.
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({
      keypair: kp2,
      userId: "u_tango",
      docRef: figureRef,
      role: null,
    });
    await seedDb({
      users: [{ id: "u_tango", displayName: "T", identityColor: "#111", plan: "free" }],
    });

    const res = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "X",
        dance: "tango",
        figureType: "x",
        routineId: "rt_test",
        attributes: [
          { id: "a1", kind: "rise", count: 1, role: null, value: "up", deletedAt: null },
        ],
      }),
    });
    expect(res.status).toBe(400);

    // The DO must NOT have been seeded — the dance gate rejected before seedDoc.
    const stub = docs2.get(docs2.idFromName(figureRef));
    const changeRows = await stub.debugChangeRowCount();
    expect(changeRows).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// #187 — figure-doc eager projection to D1 (the figure analog of routines' #129).
//
// A client-minted figure (custom on "Add figure", US-027) must be projected to
// document_registry + given an owner membership, or the fail-closed DO boundary
// (US-021) can't owner-resolve a connect to it → 403. CLERK_JWT_KEY is the static
// test PEM, so the minted tokens verify networklessly.
// ─────────────────────────────────────────────────────────────────────────

const docs = env.DOC_DO as unknown as DocNamespace;
let kp: TestKeypair;

beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

/** Open a connection to a doc DO as the real Worker route does (x-doc-name + auth). */
async function tryConnect(docName: string, headers: Record<string, string>): Promise<Response> {
  const stub = docs.get(docs.idFromName(docName));
  return stub.fetch(
    new Request("https://do/connect", {
      headers: { Upgrade: "websocket", "x-doc-name": docName, ...headers },
    }),
  );
}

describe("#187 figure-doc projection", () => {
  it("projects a figure registry row + owner membership; the owner can then connect", async () => {
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_fig",
      docRef: figureRef,
      role: null,
    });
    await seedDb({
      users: [{ id: "u_fig", displayName: "F", identityColor: "#111", plan: "free" }],
    });
    const rtFig = await seedOwnedRoutine("u_fig");

    const res = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Feather",
        dance: "foxtrot",
        figureType: "feather",
        routineId: rtFig,
      }),
    });
    expect(res.status).toBe(201);

    // The registry row exists, typed "account-figure", owned by the verified sub.
    const row = await env.DB.prepare("SELECT type, ownerId FROM document_registry WHERE docRef = ?")
      .bind(figureRef)
      .first<{ type: string; ownerId: string }>();
    expect(row).toMatchObject({ type: "account-figure", ownerId: "u_fig" });

    // The owner membership row exists (editor).
    const mem = await env.DB.prepare(
      "SELECT role FROM membership WHERE docRef = ? AND userId = ? AND deletedAt IS NULL",
    )
      .bind(figureRef, "u_fig")
      .first<{ role: string }>();
    expect(mem?.role).toBe("editor");

    // Owner elevation now resolves → the fail-closed connect accepts (101, not 403).
    const conn = await tryConnect(figureRef, ctx.authHeaders());
    expect(conn.status).toBe(101);
  });

  it("allows a SECOND account-figure derived from the SAME base by the same owner (⟳v5 variants; migration 0017)", async () => {
    // REGRESSION (the reported "toast shows but the step vanishes" bug): editing a
    // placed CATALOG figure spawns a variant via POST /api/figures, stamped with
    // `baseFigureRef = global:<dance>:<figureType>`. Re-timing the SAME catalog
    // figure a second time (another routine, or after a prior variant) minted
    // another variant with the SAME base. Migration 0010's UNIQUE(ownerId,
    // forkedFromRef) swallowed the second INSERT → 409 → the client dropped the
    // edit behind an optimistic toast. Migration 0017 drops that index: a user may
    // own MANY variants of the same base, so BOTH creates must 201.
    const base = "global:waltz:running-spin-turn";
    const ctx = await authedContext({ keypair: kp, userId: "u_mv", docRef: base, role: null });
    await seedDb({
      users: [{ id: "u_mv", displayName: "MV", identityColor: "#111", plan: "free" }],
    });
    const rt = await seedOwnedRoutine("u_mv");

    const spawnVariant = (figureRef: string) =>
      SELF.fetch("https://x/api/figures", {
        method: "POST",
        headers: { ...ctx.authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          figureRef,
          name: "Running Spin Turn",
          dance: "waltz",
          figureType: "running-spin-turn",
          routineId: rt,
          baseFigureRef: base,
        }),
      });

    const firstRef = uniqueDocName("fig_var");
    const secondRef = uniqueDocName("fig_var");
    expect((await spawnVariant(firstRef)).status).toBe(201);
    // Pre-0017 this second create 409'd on the (owner, base) unique index.
    expect((await spawnVariant(secondRef)).status).toBe(201);

    // Both variants are real, independent, owner-owned rows sharing the one base.
    const derivatives = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE ownerId = ? AND forkedFromRef = ? AND type = 'account-figure' AND deletedAt IS NULL",
    )
      .bind("u_mv", base)
      .first<{ n: number }>();
    expect(derivatives?.n).toBe(2);
  });

  it("the projection is what UNBLOCKS the connect (owner 403 before, 101 after)", async () => {
    // RED property (the figure analog of US-021 owner elevation): the ONLY thing
    // that changes between the two connects is the projection. An owner connecting
    // to an UN-projected figure is 403; after POST /api/figures projects the
    // registry row + owner membership, the SAME owner's connect is 101. Removing
    // the projection (or the owner-membership row) flips 101 → 403 — proving the
    // projection is load-bearing, not incidental.
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({ keypair: kp, userId: "u_p", docRef: figureRef, role: null });
    await seedDb({ users: [{ id: "u_p", displayName: "P", identityColor: "#111", plan: "free" }] });
    const rtP = await seedOwnedRoutine("u_p");

    // Before projection: the owner can't reach their own (un-indexed) figure.
    expect((await tryConnect(figureRef, ctx.authHeaders())).status).toBe(403);

    // Project it.
    const res = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Feather",
        dance: "foxtrot",
        figureType: "feather",
        routineId: rtP,
      }),
    });
    expect(res.status).toBe(201);

    // After projection: the SAME owner's connect is accepted.
    expect((await tryConnect(figureRef, ctx.authHeaders())).status).toBe(101);
  });

  it("rejects a non-member connection to the figure (per-doc, fail-closed)", async () => {
    const figureRef = uniqueDocName("fig");
    const owner = await authedContext({
      keypair: kp,
      userId: "u_o",
      docRef: figureRef,
      role: null,
    });
    const stranger = await authedContext({
      keypair: kp,
      userId: "u_s",
      docRef: figureRef,
      role: null,
    });
    await seedDb({
      users: [
        { id: "u_o", displayName: "O", identityColor: "#111", plan: "free" },
        { id: "u_s", displayName: "S", identityColor: "#222", plan: "free" },
      ],
    });
    const rtO = await seedOwnedRoutine("u_o");
    await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...owner.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Three Step",
        dance: "foxtrot",
        figureType: "three_step",
        routineId: rtO,
      }),
    });
    const conn = await tryConnect(figureRef, stranger.authHeaders());
    expect(conn.status).toBe(403);
  });

  it("does NOT count a created figure against the owned-routine quota/list", async () => {
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({ keypair: kp, userId: "u_q", docRef: figureRef, role: null });
    await seedDb({ users: [{ id: "u_q", displayName: "Q", identityColor: "#111", plan: "free" }] });
    const rtQ = await seedOwnedRoutine("u_q");
    await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Reverse Wave",
        dance: "waltz",
        figureType: "reverse_wave",
        routineId: rtQ,
      }),
    });
    // The figure is NOT a routine: the routine list (and thus the quota count) excludes it.
    const list = await SELF.fetch("https://x/api/routines", { headers: ctx.authHeaders() });
    const { routines } = (await list.json()) as { routines: Array<{ docRef: string }> };
    expect(routines.some((r) => r.docRef === figureRef)).toBe(false);
  });

  it("validates the figure body (empty name → 400)", async () => {
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({ keypair: kp, userId: "u_v2", docRef: figureRef, role: null });
    await seedDb({
      users: [{ id: "u_v2", displayName: "V", identityColor: "#111", plan: "free" }],
    });
    const res = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ figureRef, name: "  ", dance: "waltz", figureType: "x" }),
    });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// v5 library-as-bookmark — "↟ Save to my library" / un-save (POST/DELETE
// /api/figures/save-to-library). Supersedes T5's frozen-copy promotion (PLAN
// §4.2/§5.2/D28): "add to my library" now records a REFERENCE in the caller's
// `library_entry` projection — never a copy. Several users may bookmark the
// SAME figureRef; un-bookmarking drops the reference only.
// ─────────────────────────────────────────────────────────────────────────

const NAT_TURN = { dance: "waltz", figureType: "natural-turn", name: "Natural Turn" } as const;
const NAT_TURN_REF = "global:waltz:natural-turn";

async function saveToLibrary(
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Response> {
  return SELF.fetch("https://x/api/figures/save-to-library", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function unsaveFromLibrary(
  headers: Record<string, string>,
  figureRef: string,
): Promise<Response> {
  return SELF.fetch("https://x/api/figures/save-to-library", {
    method: "DELETE",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ figureRef }),
  });
}

async function mineDocRefs(headers: Record<string, string>): Promise<string[]> {
  const res = await SELF.fetch("https://x/api/figures/mine", { headers });
  const { figures } = (await res.json()) as { figures: Array<{ docRef: string }> };
  return figures.map((f) => f.docRef);
}

describe("v5 library bookmark — POST /api/figures/save-to-library (catalog, legacy triple)", () => {
  it("bookmarks the catalog figure itself — no copy is minted", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_save", docRef: "x", role: null });
    await seedDb({
      users: [{ id: "u_save", displayName: "S", identityColor: "#111", plan: "free" }],
    });

    const res = await saveToLibrary(ctx.authHeaders(), NAT_TURN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadySaved: boolean };
    expect(body.alreadySaved).toBe(false);

    // NO account-figure doc/registry row was created for this bookmark.
    const row = await env.DB.prepare("SELECT docRef FROM document_registry WHERE forkedFromRef = ?")
      .bind(NAT_TURN_REF)
      .first();
    expect(row).toBeNull();

    // The LibraryEntry row references the CATALOG ref directly.
    const entry = await env.DB.prepare(
      "SELECT userId, figureRef, deletedAt FROM library_entry WHERE userId = ? AND figureRef = ?",
    )
      .bind("u_save", NAT_TURN_REF)
      .first<{ userId: string; figureRef: string; deletedAt: number | null }>();
    expect(entry).toMatchObject({ userId: "u_save", figureRef: NAT_TURN_REF, deletedAt: null });

    // It surfaces in "mine" resolved from the bundled catalog (no D1 registry row).
    const mine = await SELF.fetch("https://x/api/figures/mine", { headers: ctx.authHeaders() });
    const { figures } = (await mine.json()) as {
      figures: Array<{ docRef: string; title: string | null; baseFigureRef: string | null }>;
    };
    const saved = figures.find((f) => f.docRef === NAT_TURN_REF);
    expect(saved).toMatchObject({
      docRef: NAT_TURN_REF,
      title: "Natural Turn",
      baseFigureRef: null,
    });
  });

  it("is idempotent — re-bookmarking the same catalog figure is a no-op", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_idem", docRef: "x", role: null });
    await seedDb({
      users: [{ id: "u_idem", displayName: "I", identityColor: "#111", plan: "free" }],
    });

    const first = await saveToLibrary(ctx.authHeaders(), NAT_TURN);
    expect(await first.json()).toMatchObject({ alreadySaved: false });

    const second = await saveToLibrary(ctx.authHeaders(), NAT_TURN);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ alreadySaved: true });

    // Exactly ONE live entry — no duplicate row.
    const cnt = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM library_entry WHERE userId = ? AND figureRef = ? AND deletedAt IS NULL",
    )
      .bind("u_idem", NAT_TURN_REF)
      .first<{ n: number }>();
    expect(cnt?.n).toBe(1);
  });

  it("refuses an unauthenticated save (401) and writes nothing", async () => {
    const res = await SELF.fetch("https://x/api/figures/save-to-library", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(NAT_TURN),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a figure not in the global catalog (404)", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_404", docRef: "x", role: null });
    await seedDb({
      users: [{ id: "u_404", displayName: "N", identityColor: "#111", plan: "free" }],
    });
    const res = await saveToLibrary(ctx.authHeaders(), {
      dance: "waltz",
      figureType: "not-a-real-figure",
      name: "Nope",
    });
    expect(res.status).toBe(404);
  });

  it("per-user isolation — two users bookmarking the SAME figure each get their own entry", async () => {
    const a = await authedContext({ keypair: kp, userId: "u_a", docRef: "x", role: null });
    const b = await authedContext({ keypair: kp, userId: "u_b", docRef: "x", role: null });
    await seedDb({
      users: [
        { id: "u_a", displayName: "A", identityColor: "#111", plan: "free" },
        { id: "u_b", displayName: "B", identityColor: "#222", plan: "free" },
      ],
    });
    await saveToLibrary(a.authHeaders(), NAT_TURN);
    await saveToLibrary(b.authHeaders(), NAT_TURN);

    // ONE shared figureRef, TWO independent LibraryEntry rows (one per user). D1
    // is SHARED across the whole worker test run (isolatedStorage: false, per
    // DEVELOPMENT.md), so other suites may ALSO hold a live entry for this same
    // catalog ref — assert u_a/u_b are both present rather than an exact set.
    const entries = await env.DB.prepare(
      "SELECT userId FROM library_entry WHERE figureRef = ? AND deletedAt IS NULL",
    )
      .bind(NAT_TURN_REF)
      .all<{ userId: string }>();
    const userIds = new Set(entries.results?.map((r) => r.userId));
    expect(userIds.has("u_a")).toBe(true);
    expect(userIds.has("u_b")).toBe(true);

    expect(await mineDocRefs(a.authHeaders())).toContain(NAT_TURN_REF);
    expect(await mineDocRefs(b.authHeaders())).toContain(NAT_TURN_REF);
  });

  it("concurrent bookmarks of the same figure never duplicate and never 500 (race-safe)", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_race", docRef: "x", role: null });
    await seedDb({
      users: [{ id: "u_race", displayName: "C", identityColor: "#111", plan: "free" }],
    });
    const fig = { dance: "waltz", figureType: "reverse-turn", name: "Reverse Turn" } as const;

    const [r1, r2] = await Promise.all([
      saveToLibrary(ctx.authHeaders(), fig),
      saveToLibrary(ctx.authHeaders(), fig),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const cnt = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM library_entry WHERE userId = 'u_race' AND figureRef = 'global:waltz:reverse-turn' AND deletedAt IS NULL",
    ).first<{ n: number }>();
    expect(cnt?.n).toBe(1);
  });
});

describe("v5 library bookmark — direct { figureRef } (account/choreo-local figures)", () => {
  it("bookmarks an account figure the caller OWNS — no copy, appears in mine", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_own", docRef: "x", role: null });
    await seedDb({
      users: [{ id: "u_own", displayName: "O", identityColor: "#111", plan: "free" }],
    });
    const rt = await seedOwnedRoutine("u_own");
    const figureRef = uniqueDocName("fig");
    await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "My Glue Step",
        dance: "waltz",
        figureType: "glue-step",
        routineId: rt,
      }),
    });

    // Choreo-local (unbookmarked) — must NOT appear in the library yet.
    expect(await mineDocRefs(ctx.authHeaders())).not.toContain(figureRef);

    const res = await saveToLibrary(ctx.authHeaders(), { figureRef });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alreadySaved: false });
    expect(await mineDocRefs(ctx.authHeaders())).toContain(figureRef);
  });

  it("403s bookmarking a figureRef the caller cannot READ, and writes nothing", async () => {
    const owner = await authedContext({ keypair: kp, userId: "u_priv1", docRef: "x", role: null });
    const stranger = await authedContext({
      keypair: kp,
      userId: "u_priv2",
      docRef: "x",
      role: null,
    });
    await seedDb({
      users: [
        { id: "u_priv1", displayName: "P1", identityColor: "#111", plan: "free" },
        { id: "u_priv2", displayName: "P2", identityColor: "#222", plan: "free" },
      ],
    });
    const rt = await seedOwnedRoutine("u_priv1");
    const figureRef = uniqueDocName("fig");
    await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...owner.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Private",
        dance: "waltz",
        figureType: "private-figure",
        routineId: rt,
      }),
    });

    const res = await saveToLibrary(stranger.authHeaders(), { figureRef });
    expect(res.status).toBe(403);

    const entry = await env.DB.prepare(
      "SELECT 1 AS one FROM library_entry WHERE userId = ? AND figureRef = ?",
    )
      .bind("u_priv2", figureRef)
      .first();
    expect(entry).toBeNull();
  });

  it("bookmarking works via the ROUTINE CASCADE — a co-member can bookmark a figure they don't own", async () => {
    // PLAN §5.1 cascade: a routine member's role extends to the figures that
    // routine references — resolveEffectiveRole resolves non-null for the
    // co-member too, so they CAN bookmark a partner's shared-choreo figure.
    const owner = await authedContext({ keypair: kp, userId: "u_co1", docRef: "x", role: null });
    const partner = await authedContext({ keypair: kp, userId: "u_co2", docRef: "x", role: null });
    await seedDb({
      users: [
        { id: "u_co1", displayName: "C1", identityColor: "#111", plan: "free" },
        { id: "u_co2", displayName: "C2", identityColor: "#222", plan: "free" },
      ],
    });
    const rt = uniqueDocName("rt");
    await seedDb({
      docs: [{ docRef: rt, type: "routine", ownerId: "u_co1", doName: rt }],
      memberships: [{ id: `m_${rt}`, docRef: rt, userId: "u_co2", role: "editor" }],
    });
    const figureRef = uniqueDocName("fig");
    await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...owner.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Shared Glue Step",
        dance: "waltz",
        figureType: "shared-glue",
        routineId: rt,
      }),
    });

    const res = await saveToLibrary(partner.authHeaders(), { figureRef });
    expect(res.status).toBe(200);
    expect(await mineDocRefs(partner.authHeaders())).toContain(figureRef);
    // The owner's own library is untouched by the partner's bookmark.
    expect(await mineDocRefs(owner.authHeaders())).not.toContain(figureRef);
  });

  it("refuses an unauthenticated bookmark (401)", async () => {
    const res = await SELF.fetch("https://x/api/figures/save-to-library", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ figureRef: "fig_x" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("v5 library un-bookmark — DELETE /api/figures/save-to-library", () => {
  it("removes the entry — the figure doc + its placements are untouched", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_un", docRef: "x", role: null });
    await seedDb({
      users: [{ id: "u_un", displayName: "U", identityColor: "#111", plan: "free" }],
    });
    const rt = await seedOwnedRoutine("u_un");
    const figureRef = uniqueDocName("fig");
    await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Un-bookmark me",
        dance: "waltz",
        figureType: "unb",
        routineId: rt,
      }),
    });
    await saveToLibrary(ctx.authHeaders(), { figureRef });
    expect(await mineDocRefs(ctx.authHeaders())).toContain(figureRef);

    const del = await unsaveFromLibrary(ctx.authHeaders(), figureRef);
    expect(del.status).toBe(200);
    expect(await mineDocRefs(ctx.authHeaders())).not.toContain(figureRef);

    // The figure doc's registry row + its routine placement edge survive —
    // un-bookmarking drops a REFERENCE, never the shared figure (§5.2).
    const registryRow = await env.DB.prepare(
      "SELECT docRef FROM document_registry WHERE docRef = ? AND deletedAt IS NULL",
    )
      .bind(figureRef)
      .first();
    expect(registryRow).not.toBeNull();
    const edge = await env.DB.prepare(
      "SELECT 1 AS one FROM placement_edge WHERE routineRef = ? AND figureRef = ?",
    )
      .bind(rt, figureRef)
      .first();
    expect(edge).not.toBeNull();
  });

  it("un-bookmarking a catalog ref drops only the CALLER's entry (other users' bookmarks survive)", async () => {
    const a = await authedContext({ keypair: kp, userId: "u_del_a", docRef: "x", role: null });
    const b = await authedContext({ keypair: kp, userId: "u_del_b", docRef: "x", role: null });
    await seedDb({
      users: [
        { id: "u_del_a", displayName: "A", identityColor: "#111", plan: "free" },
        { id: "u_del_b", displayName: "B", identityColor: "#222", plan: "free" },
      ],
    });
    await saveToLibrary(a.authHeaders(), NAT_TURN);
    await saveToLibrary(b.authHeaders(), NAT_TURN);

    await unsaveFromLibrary(a.authHeaders(), NAT_TURN_REF);
    expect(await mineDocRefs(a.authHeaders())).not.toContain(NAT_TURN_REF);
    expect(await mineDocRefs(b.authHeaders())).toContain(NAT_TURN_REF);
  });

  it("is idempotent — un-bookmarking an absent entry still 200s", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_noop", docRef: "x", role: null });
    await seedDb({
      users: [{ id: "u_noop", displayName: "N", identityColor: "#111", plan: "free" }],
    });
    const res = await unsaveFromLibrary(ctx.authHeaders(), "global:waltz:never-saved");
    expect(res.status).toBe(200);
  });

  it("refuses an unauthenticated un-bookmark (401)", async () => {
    const res = await SELF.fetch("https://x/api/figures/save-to-library", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ figureRef: "fig_x" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("v5 library bookmark — the library_entry query is indexed (NFR: no D1 SCAN)", () => {
  it("the per-user bookmark lookup hits the PRIMARY KEY, no full-table SCAN", async () => {
    await seedDb({
      libraryEntries: [{ userId: "u_explain", figureRef: "global:waltz:natural-turn" }],
    });
    await expectIndexedQuery(
      env.DB,
      "SELECT figureRef FROM library_entry WHERE userId = ?1 AND deletedAt IS NULL",
      ["u_explain"],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2026-07-02 review authz regressions — POST /api/figures cross-user attacks.
//
// The route previously (a) never checked the caller's rights on `routineId`
// and (b) upserted the registry row + inserted the caller's editor membership
// on ANY posted figureRef. Combined with the role cascade (a routine editor
// may edit the figures the routine references), that was a viewer→editor
// privilege escalation on any figure whose ref leaked (refs are visible to
// every viewer of any shared routine). These tests pin the closed holes.
// ─────────────────────────────────────────────────────────────────────────

describe("2026-07-02 authz: POST /api/figures cross-user attacks", () => {
  it("403s when the caller cannot edit the target routine, writing nothing", async () => {
    const figureRef = uniqueDocName("fig");
    const victimRoutine = uniqueDocName("rt");
    const attacker = await authedContext({
      keypair: kp,
      userId: "u_atk1",
      docRef: figureRef,
      role: null,
    });
    await seedDb({
      users: [
        { id: "u_atk1", displayName: "A", identityColor: "#111", plan: "free" },
        { id: "u_vic1", displayName: "V", identityColor: "#222", plan: "free" },
      ],
      // The routine belongs to the victim; the attacker has NO membership on it.
      docs: [{ docRef: victimRoutine, type: "routine", ownerId: "u_vic1", doName: victimRoutine }],
    });

    const res = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...attacker.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Sneaky",
        dance: "waltz",
        figureType: "natural-turn",
        routineId: victimRoutine,
      }),
    });
    expect(res.status).toBe(403);

    // Nothing was written: no registry row, no membership, no placement edge.
    const row = await env.DB.prepare("SELECT docRef FROM document_registry WHERE docRef = ?")
      .bind(figureRef)
      .first();
    expect(row).toBeNull();
    const edge = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM placement_edge WHERE figureRef = ?",
    )
      .bind(figureRef)
      .first<{ n: number }>();
    expect(edge?.n).toBe(0);
  });

  it("409s on a figureRef owned by someone else — no rewrite, no membership, no cascade", async () => {
    // The escalation scenario: the victim owns a figure; the attacker re-POSTs
    // the victim's figureRef bound to the attacker's OWN routine, which used to
    // (a) rewrite the victim's registry title, (b) insert the attacker's editor
    // membership on the victim's doc, and (c) create a placement edge that
    // cascades the attacker to editor. All three must be refused.
    const figureRef = uniqueDocName("fig");
    const victim = await authedContext({
      keypair: kp,
      userId: "u_vic2",
      docRef: figureRef,
      role: null,
    });
    const attacker = await authedContext({
      keypair: kp,
      userId: "u_atk2",
      docRef: figureRef,
      role: null,
    });
    await seedDb({
      users: [
        { id: "u_vic2", displayName: "V", identityColor: "#111", plan: "free" },
        { id: "u_atk2", displayName: "A", identityColor: "#222", plan: "free" },
      ],
    });
    const victimRoutine = await seedOwnedRoutine("u_vic2");
    const attackerRoutine = await seedOwnedRoutine("u_atk2");

    // Victim legitimately creates the figure.
    const create = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...victim.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Victim Figure",
        dance: "waltz",
        figureType: "natural-turn",
        routineId: victimRoutine,
      }),
    });
    expect(create.status).toBe(201);

    // Attacker re-POSTs the victim's figureRef into their own routine.
    const attack = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...attacker.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Defaced",
        dance: "waltz",
        figureType: "natural-turn",
        routineId: attackerRoutine,
      }),
    });
    expect(attack.status).toBe(409);

    // The victim's registry row is untouched (owner AND title).
    const row = await env.DB.prepare(
      "SELECT ownerId, title FROM document_registry WHERE docRef = ?",
    )
      .bind(figureRef)
      .first<{ ownerId: string; title: string }>();
    expect(row).toMatchObject({ ownerId: "u_vic2", title: "Victim Figure" });

    // No attacker membership row was inserted.
    const mem = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM membership WHERE docRef = ? AND userId = 'u_atk2'",
    )
      .bind(figureRef)
      .first<{ n: number }>();
    expect(mem?.n).toBe(0);

    // No placement edge from the attacker's routine (no cascade path).
    const edge = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM placement_edge WHERE routineRef = ? AND figureRef = ?",
    )
      .bind(attackerRoutine, figureRef)
      .first<{ n: number }>();
    expect(edge?.n).toBe(0);

    // Net effect: the attacker still cannot connect to the victim's figure.
    const conn = await tryConnect(figureRef, attacker.authHeaders());
    expect(conn.status).toBe(403);
  });

  it("stays idempotent for the legitimate owner (retried request → 201, single membership)", async () => {
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_own3",
      docRef: figureRef,
      role: null,
    });
    await seedDb({
      users: [{ id: "u_own3", displayName: "O", identityColor: "#111", plan: "free" }],
    });
    const rt = await seedOwnedRoutine("u_own3");
    const body = JSON.stringify({
      figureRef,
      name: "Mine",
      dance: "waltz",
      figureType: "whisk",
      routineId: rt,
    });
    const first = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body,
    });
    const retry = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body,
    });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    const mem = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM membership WHERE docRef = ? AND userId = 'u_own3'",
    )
      .bind(figureRef)
      .first<{ n: number }>();
    expect(mem?.n).toBe(1);
  });
});
