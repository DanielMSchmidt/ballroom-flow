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

    const res = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Natural Turn",
        dance: "waltz",
        figureType: "natural-turn",
        routineId: "rt_test",
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

    const res = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Feather",
        dance: "foxtrot",
        figureType: "feather",
        routineId: "rt_test",
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
        routineId: "rt_test",
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
    await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...owner.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Three Step",
        dance: "foxtrot",
        figureType: "three_step",
        routineId: "rt_test",
      }),
    });
    const conn = await tryConnect(figureRef, stranger.authHeaders());
    expect(conn.status).toBe(403);
  });

  it("does NOT count a created figure against the owned-routine quota/list", async () => {
    const figureRef = uniqueDocName("fig");
    const ctx = await authedContext({ keypair: kp, userId: "u_q", docRef: figureRef, role: null });
    await seedDb({ users: [{ id: "u_q", displayName: "Q", identityColor: "#111", plan: "free" }] });
    await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef,
        name: "Reverse Wave",
        dance: "waltz",
        figureType: "reverse_wave",
        routineId: "rt_test",
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
