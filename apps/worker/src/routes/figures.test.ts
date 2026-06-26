import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { uniqueDocName } from "../test-support/do-id";
import type { DocNamespace } from "../test-support/doc-do-api";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

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
      body: JSON.stringify({ figureRef, name: "Feather", dance: "foxtrot", figureType: "feather" }),
    });
    expect(res.status).toBe(201);

    // The registry row exists, typed "figure", owned by the verified sub.
    const row = await env.DB.prepare("SELECT type, ownerId FROM document_registry WHERE docRef = ?")
      .bind(figureRef)
      .first<{ type: string; ownerId: string }>();
    expect(row).toMatchObject({ type: "figure", ownerId: "u_fig" });

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
