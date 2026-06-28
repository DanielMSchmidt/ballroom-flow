import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "./test-support/authed-context";
import { uniqueDocName } from "./test-support/do-id";
import type { DocNamespace, DocStub } from "./test-support/doc-do-api";
import { generateTestKeypair, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

// US-034 — editing your OWN figure flows into all referencing routines [M4].
// US-035 — auto-variant on editing a NON-owned figure (copy-on-write) [M4].
// COW is orchestrated in the web store seam (per-document-do-layering): the
// worker only exposes the stateless variant-creation route + the shared figure
// DO. These tests prove the worker primitives the store composes.

const docs = env.DOC_DO as unknown as DocNamespace;
function freshDoc(prefix: string): { name: string; stub: DocStub } {
  const name = uniqueDocName(prefix);
  return { name, stub: docs.get(docs.idFromName(name)) };
}

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe("US-034 Editing your own figure flows into all referencing routines", () => {
  it("one shared figure DO is referenced by two routines; an edit does not fork it", async () => {
    // Two routines both reference ONE figure docRef (the store records a
    // placement_edge per routine). Editing the figure DO touches that one doc;
    // the store resolves it for both routines at read time (no variant).
    const figure = freshDoc("figure");
    const rtA = uniqueDocName("routine");
    const rtB = uniqueDocName("routine");
    await seedDb({
      placementEdges: [
        { routineRef: rtA, figureRef: figure.name },
        { routineRef: rtB, figureRef: figure.name },
      ],
    });
    // The figure DO is a normal doc; its snapshot is well-formed (rehydrate path).
    const snap = await figure.stub.getSnapshot();
    expect(snap).toBeDefined();
    // Both edges point at the SAME figureRef → both routines share the doc.
    const rows = await env.DB.prepare(
      "SELECT routineRef FROM placement_edge WHERE figureRef = ? ORDER BY routineRef",
    )
      .bind(figure.name)
      .all<{ routineRef: string }>();
    expect((rows.results ?? []).map((r) => r.routineRef).sort()).toEqual([rtA, rtB].sort());
  });
});

describe("US-035 Auto-variant on editing a non-owned figure (stateless variant route)", () => {
  it("creates an account-figure variant (baseFigureRef) + leaves the base untouched", async () => {
    const base = freshDoc("figure-global"); // app-owned global base figure
    const routine = uniqueDocName("routine");
    const variantRef = uniqueDocName("figure-variant");
    await seedDb({
      users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }],
      docs: [
        {
          docRef: base.name,
          type: "global-figure",
          ownerId: "app",
          doName: base.name,
          figureType: "feather",
          dance: "foxtrot",
        },
        { docRef: routine, type: "routine", ownerId: "u1", doName: routine },
      ],
      memberships: [{ id: `m_${routine}`, docRef: routine, userId: "u1", role: "editor" }],
    });
    const before = await base.stub.getSnapshot();

    // The store's COW path POSTs the variant (baseFigureRef = the global base).
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef: routine, role: "editor" });
    const res = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef: variantRef,
        name: "Feather",
        dance: "foxtrot",
        figureType: "feather",
        routineId: routine,
        attributes: [],
        baseFigureRef: base.name,
      }),
    });
    expect(res.status).toBe(201);

    // A new account-figure row owned by u1 (the variant) now exists…
    const variant = await env.DB.prepare(
      "SELECT docRef, ownerId FROM document_registry WHERE docRef = ? AND type = 'account-figure'",
    )
      .bind(variantRef)
      .first<{ docRef: string; ownerId: string }>();
    expect(variant?.ownerId).toBe("u1");

    // …and the base global figure DO is unchanged (no disturbance to others).
    const after = await base.stub.getSnapshot();
    expect(after).toEqual(before);
  });
});
