import { env, runInDurableObject, SELF } from "cloudflare:test";
import * as A from "@automerge/automerge";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { uniqueDocName } from "../test-support/do-id";
import type { DocNamespace } from "../test-support/doc-do-api";
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
// T5 — "↟ Save to my library" (POST /api/figures/save-to-library).
//
// Promotes a GLOBAL-catalog figure into the caller's personal library as a FROZEN
// account-figure copy (PLAN §5.2): owner = caller (from the JWT, never a client
// field), baseFigureRef = globalFigureRef(dance, figureType) provenance. Idempotent
// on (owner, baseFigureRef). The catalog figure is resolved server-side.
// ─────────────────────────────────────────────────────────────────────────

const NAT_TURN = { dance: "waltz", figureType: "natural-turn", name: "Natural Turn" } as const;

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

describe("T5 save-to-library promotion", () => {
  it("creates a frozen account-figure copy owned by the caller, with provenance", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_save", docRef: "x", role: null });
    await seedDb({
      users: [{ id: "u_save", displayName: "S", identityColor: "#111", plan: "free" }],
    });

    const res = await saveToLibrary(ctx.authHeaders(), NAT_TURN);
    expect(res.status).toBe(201);
    const { figureRef, baseFigureRef, alreadySaved } = (await res.json()) as {
      figureRef: string;
      baseFigureRef: string;
      alreadySaved: boolean;
    };
    expect(alreadySaved).toBe(false);
    expect(baseFigureRef).toBe("global:waltz:natural-turn");

    // The registry row is an account-figure owned by the verified sub, carrying the
    // global figure's provenance in forkedFromRef (the reused lineage column).
    const row = await env.DB.prepare(
      "SELECT type, ownerId, forkedFromRef, dance, figureType FROM document_registry WHERE docRef = ?",
    )
      .bind(figureRef)
      .first<{
        type: string;
        ownerId: string;
        forkedFromRef: string;
        dance: string;
        figureType: string;
      }>();
    expect(row).toMatchObject({
      type: "account-figure",
      ownerId: "u_save",
      forkedFromRef: "global:waltz:natural-turn",
      dance: "waltz",
      figureType: "natural-turn",
    });

    // It surfaces in the caller's "mine" list as a saved (baseFigureRef-set) figure.
    const mine = await SELF.fetch("https://x/api/figures/mine", { headers: ctx.authHeaders() });
    const { figures } = (await mine.json()) as {
      figures: Array<{ docRef: string; baseFigureRef: string | null; usedInCount: number }>;
    };
    const saved = figures.find((f) => f.docRef === figureRef);
    expect(saved?.baseFigureRef).toBe("global:waltz:natural-turn");
    expect(saved?.usedInCount).toBe(0);
  });

  it("is idempotent — re-saving the same global figure returns the existing copy", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_idem", docRef: "x", role: null });
    await seedDb({
      users: [{ id: "u_idem", displayName: "I", identityColor: "#111", plan: "free" }],
    });

    const first = await saveToLibrary(ctx.authHeaders(), NAT_TURN);
    const firstBody = (await first.json()) as { figureRef: string };

    const second = await saveToLibrary(ctx.authHeaders(), NAT_TURN);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { figureRef: string; alreadySaved: boolean };
    expect(secondBody.alreadySaved).toBe(true);
    expect(secondBody.figureRef).toBe(firstBody.figureRef);

    // Exactly ONE copy exists for this (owner, base) — no duplicate row.
    const cnt = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE ownerId = ? AND type = 'account-figure' AND forkedFromRef = ? AND deletedAt IS NULL",
    )
      .bind("u_idem", "global:waltz:natural-turn")
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

  it("scopes idempotency per-owner — two users each get their own copy", async () => {
    const a = await authedContext({ keypair: kp, userId: "u_a", docRef: "x", role: null });
    const b = await authedContext({ keypair: kp, userId: "u_b", docRef: "x", role: null });
    await seedDb({
      users: [
        { id: "u_a", displayName: "A", identityColor: "#111", plan: "free" },
        { id: "u_b", displayName: "B", identityColor: "#222", plan: "free" },
      ],
    });
    const ra = (await (await saveToLibrary(a.authHeaders(), NAT_TURN)).json()) as {
      figureRef: string;
    };
    const rb = (await (await saveToLibrary(b.authHeaders(), NAT_TURN)).json()) as {
      figureRef: string;
    };
    // Distinct copies, each owned by its caller — no cross-user dedupe/write.
    expect(ra.figureRef).not.toBe(rb.figureRef);
    const owners = await env.DB.prepare(
      "SELECT docRef, ownerId FROM document_registry WHERE forkedFromRef = 'global:waltz:natural-turn' AND ownerId IN ('u_a','u_b')",
    ).all<{ docRef: string; ownerId: string }>();
    expect(new Set(owners.results?.map((r) => r.ownerId))).toEqual(new Set(["u_a", "u_b"]));
    expect(owners.results).toHaveLength(2);
  });

  it("US-034 edit-ripple: one saved figure is referenced by many routines (no duplication)", async () => {
    // A personal-library figure reused across the user's routines is ONE doc — editing
    // it flows into every referencing routine (the routines reference its docRef; the
    // figure is never duplicated on edit). We prove the reuse shape: a single saved
    // figure row, referenced by two routines, surfaces as usedInCount=2.
    const ctx = await authedContext({ keypair: kp, userId: "u_rip", docRef: "x", role: null });
    await seedDb({
      users: [{ id: "u_rip", displayName: "R", identityColor: "#111", plan: "free" }],
    });
    const saved = (await (await saveToLibrary(ctx.authHeaders(), NAT_TURN)).json()) as {
      figureRef: string;
    };

    // Two of the user's routines reference the SAME saved figure doc (placement edges).
    await env.DB.prepare(
      "INSERT OR IGNORE INTO placement_edge (routineRef, figureRef) VALUES (?, ?)",
    )
      .bind("rt_one", saved.figureRef)
      .run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO placement_edge (routineRef, figureRef) VALUES (?, ?)",
    )
      .bind("rt_two", saved.figureRef)
      .run();

    const mine = await SELF.fetch("https://x/api/figures/mine", { headers: ctx.authHeaders() });
    const { figures } = (await mine.json()) as {
      figures: Array<{ docRef: string; usedInCount: number }>;
    };
    const refs = figures.filter((f) => f.docRef === saved.figureRef);
    // Exactly one figure doc, reused by two routines — not two copies.
    expect(refs).toHaveLength(1);
    expect(refs[0]?.usedInCount).toBe(2);
  });

  it("US-034 edit-ripple (LIVE): an edit to the saved figure shows in BOTH routines that reference it", async () => {
    // The stronger proof the structural test can't give: a REAL edit to the saved
    // account-figure's DO (ingested via the same applyRawChange sync path an editor's
    // change takes) surfaces — once, identically — in every routine that references
    // it. Two routines reference ONE figure doc; we edit that doc and read both
    // routines' read-only snapshots. Single source, no duplication, no per-routine copy.
    const ctx = await authedContext({ keypair: kp, userId: "u_live", docRef: "x", role: null });
    const rtA = uniqueDocName("rt");
    const rtB = uniqueDocName("rt");
    await seedDb({
      users: [{ id: "u_live", displayName: "L", identityColor: "#111", plan: "free" }],
      docs: [
        {
          docRef: rtA,
          type: "routine",
          ownerId: "u_live",
          doName: rtA,
          dance: "waltz",
          title: "A",
        },
        {
          docRef: rtB,
          type: "routine",
          ownerId: "u_live",
          doName: rtB,
          dance: "waltz",
          title: "B",
        },
      ],
      memberships: [
        { id: `m_${rtA}`, docRef: rtA, userId: "u_live", role: "editor" },
        { id: `m_${rtB}`, docRef: rtB, userId: "u_live", role: "editor" },
      ],
    });

    // Save the global figure → ONE account-figure doc (its DO seeded with name "Natural Turn").
    const saved = (await (await saveToLibrary(ctx.authHeaders(), NAT_TURN)).json()) as {
      figureRef: string;
    };
    const figureRef = saved.figureRef;

    // Seed both routine DOs with a placement that references the SAME saved figure.
    for (const ref of [rtA, rtB]) {
      await docs.get(docs.idFromName(ref)).seedDoc({
        id: ref,
        title: ref,
        dance: "waltz",
        ownerId: "u_live",
        sections: [
          {
            id: `sec_${ref}`,
            name: "Intro",
            placements: [{ id: `pl_${ref}`, figureRef, deletedAt: null }],
            deletedAt: null,
          },
        ],
        annotations: [],
        schemaVersion: 1,
        deletedAt: null,
      });
    }

    // A LIVE edit to the figure doc: rename it via the real change-ingest path
    // (applyRawChange = the US-015 sync entrypoint an editor's WebSocket change hits).
    const figStub = docs.get(docs.idFromName(figureRef));
    await runInDurableObject(
      figStub as unknown as DurableObjectStub<import("../doc-do").DocDO>,
      async (instance) => {
        const doState = (instance as unknown as { ctx: DurableObjectState }).ctx;
        const rows = doState.storage.sql
          .exec("SELECT data FROM changes ORDER BY seq")
          .toArray() as Array<{ data: ArrayBuffer }>;
        let doc = A.init<Record<string, unknown>>();
        [doc] = A.applyChanges(
          doc,
          rows.map((r) => new Uint8Array(r.data) as A.Change),
        );
        const edited = A.change(doc, (d: Record<string, unknown>) => {
          d.name = "Natural Turn (edited)";
        });
        const changeBytes = A.getChanges(doc, edited);
        const applyRaw = (
          instance as unknown as { applyRawChange: (c: Uint8Array) => Promise<boolean> }
        ).applyRawChange;
        for (const ch of changeBytes) await applyRaw.call(instance, ch);
      },
    );

    // Read BOTH routines' read-only snapshots; each hydrates the figure from its single DO.
    const readFigureName = async (routineRef: string) => {
      const res = await SELF.fetch(`https://x/api/routines/${routineRef}/snapshot`, {
        headers: ctx.authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        figures: Record<string, { name?: string } | undefined>;
      };
      return { figureKeys: Object.keys(body.figures), name: body.figures[figureRef]?.name };
    };

    const a = await readFigureName(rtA);
    const b = await readFigureName(rtB);
    // The edit rippled to BOTH — single source of truth.
    expect(a.name).toBe("Natural Turn (edited)");
    expect(b.name).toBe("Natural Turn (edited)");
    // No duplication: each routine references the one figure doc by the same ref.
    expect(a.figureKeys).toEqual([figureRef]);
    expect(b.figureKeys).toEqual([figureRef]);
  });

  it("the DB partial unique index forbids a duplicate copy for the same (owner, base)", async () => {
    // Deterministic proof of the TOCTOU guard (migration 0010): a second account-figure
    // row with the SAME (ownerId, forkedFromRef) and deletedAt IS NULL is rejected by
    // the partial unique index — the app-level SELECT is no longer the only line of defence.
    await seedDb({
      users: [{ id: "u_uniq", displayName: "U", identityColor: "#111", plan: "free" }],
    });
    const base = "global:waltz:reverse-turn";
    const insert = (docRef: string) =>
      env.DB.prepare(
        "INSERT INTO document_registry (docRef, type, ownerId, doName, forkedFromRef, updatedAt) VALUES (?, 'account-figure', 'u_uniq', ?, ?, 1)",
      )
        .bind(docRef, docRef, base)
        .run();
    await insert("af_uniq_1");
    await expect(insert("af_uniq_2")).rejects.toThrow();
  });

  it("concurrent saves of the same figure never duplicate and never 500 (race-safe)", async () => {
    // Two saves issued together race the SELECT→INSERT window. The DB unique index is
    // the real guard; the route catches the conflict and returns the existing copy.
    // Invariant under any interleaving: both responses are 2xx for the SAME figureRef,
    // and exactly ONE row exists — never a duplicate, never a 500.
    const ctx = await authedContext({ keypair: kp, userId: "u_race", docRef: "x", role: null });
    await seedDb({
      users: [{ id: "u_race", displayName: "C", identityColor: "#111", plan: "free" }],
    });
    const fig = { dance: "waltz", figureType: "reverse-turn", name: "Reverse Turn" } as const;

    const [r1, r2] = await Promise.all([
      saveToLibrary(ctx.authHeaders(), fig),
      saveToLibrary(ctx.authHeaders(), fig),
    ]);
    expect(r1.status).toBeLessThan(300);
    expect(r2.status).toBeLessThan(300);
    expect(r1.status).not.toBe(500);
    expect(r2.status).not.toBe(500);
    const b1 = (await r1.json()) as { figureRef: string };
    const b2 = (await r2.json()) as { figureRef: string };
    expect(b1.figureRef).toBe(b2.figureRef);

    const cnt = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE ownerId = 'u_race' AND type = 'account-figure' AND forkedFromRef = 'global:waltz:reverse-turn' AND deletedAt IS NULL",
    ).first<{ n: number }>();
    expect(cnt?.n).toBe(1);
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
