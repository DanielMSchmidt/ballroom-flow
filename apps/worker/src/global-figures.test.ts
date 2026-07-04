// ⟳v5 global figure docs (PLAN §9 step 3, D28/D30/D31): the additive seeder, the
// global-figure read/write boundary (resolveEffectiveRole), and the admin-gated
// seed route.
import { env, SELF } from "cloudflare:test";
import type { LibraryFigure } from "@weavesteps/domain";
import { globalFigureRef } from "@weavesteps/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveEffectiveRole } from "./db/membership";
import type { DocNamespace } from "./test-support/doc-do-api";
import { generateTestKeypair, makeTestJWT, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

const docs = env.DOC_DO as unknown as DocNamespace;
// The seeder takes the worker Env; cast the test env (same bindings) to it.
// biome-ignore lint/suspicious/noExplicitAny: the test env structurally satisfies Env.
const seedEnv = env as any;

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

// A tiny catalog subset so a run seeds ONE DO, not all 241.
const SAMPLE: LibraryFigure[] = [
  {
    dance: "waltz",
    figureType: "gf_test_family",
    name: "GF Test Figure",
    timing: "1 2 3",
    attributes: [
      { id: "a1", kind: "direction", count: 1, role: null, value: "forward", deletedAt: null },
      { id: "a2", kind: "footwork", count: 1, role: null, value: "HT", deletedAt: null },
    ],
  },
];

describe("seedGlobalFigures — additive, idempotent import (D30)", () => {
  it("creates a global-figure D1 row + DO content with scope global; is idempotent", async () => {
    const { seedGlobalFigures } = await import("./seed-global-figures");
    const ref = globalFigureRef("waltz", "gf_test_family");

    const first = await seedGlobalFigures(seedEnv, { figures: SAMPLE });
    expect(first.created).toBe(1);
    expect(first.skipped).toBe(0);

    // D1 registry row: global-figure, app-owned, keyed by the cross-dance ref.
    const row = await env.DB.prepare(
      "SELECT type, ownerId, dance, figureType, title FROM document_registry WHERE docRef = ?",
    )
      .bind(ref)
      .first<{ type: string; ownerId: string; dance: string; figureType: string; title: string }>();
    expect(row).toMatchObject({
      type: "global-figure",
      ownerId: "app",
      dance: "waltz",
      figureType: "gf_test_family",
    });

    // DO content: scope global + the charted attributes.
    const fig = (await docs.get(docs.idFromName(ref)).getFigureSnapshot()) as {
      scope?: string;
      attributes?: unknown[];
    } | null;
    expect(fig?.scope).toBe("global");
    expect(fig?.attributes?.length).toBe(2);

    // Re-run: additive → nothing new created, existing doc untouched (D30).
    const second = await seedGlobalFigures(seedEnv, { figures: SAMPLE });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
  });
});

describe("resolveEffectiveRole — global figure boundary (⟳v5, §5.1)", () => {
  it("resolves any authenticated non-admin user to VIEWER on a global figure doc", async () => {
    const ref = "global:waltz:gf_role_viewer";
    await seedDb({
      users: [{ id: "u_reader", displayName: "R", identityColor: "#111", plan: "free" }],
      docs: [
        {
          docRef: ref,
          type: "global-figure",
          ownerId: "app",
          doName: ref,
          dance: "waltz",
          figureType: "gf_role_viewer",
          title: "X",
        },
      ],
    });
    const role = await resolveEffectiveRole(env.DB, ref, "u_reader");
    expect(role).toBe("viewer");
  });

  it("resolves an ADMIN user to EDITOR on a global figure doc", async () => {
    const ref = "global:waltz:gf_role_admin";
    await seedDb({
      users: [
        { id: "u_admin", displayName: "A", identityColor: "#111", plan: "free", isAdmin: true },
      ],
      docs: [
        {
          docRef: ref,
          type: "global-figure",
          ownerId: "app",
          doName: ref,
          dance: "waltz",
          figureType: "gf_role_admin",
          title: "X",
        },
      ],
    });
    const role = await resolveEffectiveRole(env.DB, ref, "u_admin");
    expect(role).toBe("editor");
  });

  it("does NOT let a routine editor cascade to editor on a PLACED global figure", async () => {
    // A user edits a routine that places a global figure. The placement edge would
    // cascade editor on an ACCOUNT figure — but the global-figure branch must win,
    // keeping them a VIEWER so their edit spawns a variant instead (§5.2).
    const ref = "global:waltz:gf_cascade";
    const rt = "rt_gf_cascade";
    await seedDb({
      users: [{ id: "u_ced", displayName: "C", identityColor: "#111", plan: "free" }],
      docs: [
        {
          docRef: ref,
          type: "global-figure",
          ownerId: "app",
          doName: ref,
          dance: "waltz",
          figureType: "gf_cascade",
          title: "X",
        },
        { docRef: rt, type: "routine", ownerId: "u_ced", doName: rt, dance: "waltz" },
      ],
      memberships: [{ id: "m_ced", docRef: rt, userId: "u_ced", role: "editor" }],
      placementEdges: [{ routineRef: rt, figureRef: ref }],
    });
    const role = await resolveEffectiveRole(env.DB, ref, "u_ced");
    expect(role).toBe("viewer");
  });
});

describe("POST /api/admin/seed-global-figures — admin-gated (D31)", () => {
  async function post(userId: string): Promise<Response> {
    const token = await makeTestJWT(kp, { sub: userId });
    return SELF.fetch("https://example.com/api/admin/seed-global-figures", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it("rejects an unauthenticated caller (401)", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/seed-global-figures", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin caller (403) before doing any work", async () => {
    await seedDb({
      users: [{ id: "u_nonadmin", displayName: "N", identityColor: "#111", plan: "free" }],
    });
    const res = await post("u_nonadmin");
    expect(res.status).toBe(403);
  });
});

describe("snapshot fans out variant BASES (⟳v5, §5.2)", () => {
  it("returns a variant's live base in `bases` so the client resolves per-beat", async () => {
    const globalRef = "global:waltz:gf_snap_base";
    const variantRef = "acct_gf_snap_variant";
    const rt = "rt_gf_snap";
    const uid = "u_snap";

    // Global base DO — a full two-beat timeline.
    await docs.get(docs.idFromName(globalRef)).seedDoc({
      id: globalRef,
      scope: "global",
      ownerId: "app",
      figureType: "gf_snap_base",
      dance: "waltz",
      name: "Snap Base",
      source: "library",
      attributes: [
        { id: "b1", kind: "direction", count: 1, role: null, value: "forward", deletedAt: null },
        { id: "b2", kind: "direction", count: 2, role: null, value: "side", deletedAt: null },
      ],
      schemaVersion: 1,
      deletedAt: null,
    });
    // Variant DO — owns only beat 2 (re-choreographed); beat 1 resolves from base.
    await docs.get(docs.idFromName(variantRef)).seedDoc({
      id: variantRef,
      scope: "account",
      ownerId: uid,
      figureType: "gf_snap_base",
      dance: "waltz",
      name: "Snap Base",
      source: "custom",
      attributes: [
        { id: "v2", kind: "direction", count: 2, role: null, value: "back", deletedAt: null },
      ],
      baseFigureRef: globalRef,
      schemaVersion: 1,
      deletedAt: null,
    });
    // Routine DO placing the variant.
    await docs.get(docs.idFromName(rt)).seedDoc({
      id: rt,
      title: "Snap",
      dance: "waltz",
      ownerId: uid,
      sections: [
        {
          id: "s1",
          name: "A",
          placements: [{ id: "p1", figureRef: variantRef, deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    await seedDb({
      users: [{ id: uid, displayName: "S", identityColor: "#111", plan: "free" }],
      docs: [{ docRef: rt, type: "routine", ownerId: uid, doName: rt, dance: "waltz" }],
      memberships: [{ id: "m_snap", docRef: rt, userId: uid, role: "editor" }],
    });

    const token = await makeTestJWT(kp, { sub: uid });
    const res = await SELF.fetch(`https://example.com/api/routines/${rt}/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      figures: Record<string, { baseFigureRef?: string }>;
      bases: Record<string, { attributes: unknown[] }>;
    };
    // The variant is present, still carrying its live base link + only its owned beat.
    expect(body.figures[variantRef]?.baseFigureRef).toBe(globalRef);
    // The base is fanned out so the client can resolve beat 1 live.
    expect(body.bases[globalRef]).toBeTruthy();
    expect(body.bases[globalRef]?.attributes.length).toBe(2);
  });
});
