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

    // Re-run with the SAME content: nothing created, nothing rewritten (D30 ⟳:
    // the reconcile is a no-op when the doc already matches the seed).
    const second = await seedGlobalFigures(seedEnv, { figures: SAMPLE });
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);
  });

  it("reconcileSeed on an unseeded figure DO does NOT materialize a routine (regression)", async () => {
    // Regression: reconcileSeed read via getDoc(), which auto-materializes AND
    // persists an empty ROUTINE when nothing is seeded — corrupting an unseeded or
    // D1-vs-DO-diverged figure DO. It now reads via loadPersisted() (no materialize)
    // and no-ops, leaving the DO's SQLite storage untouched.
    const ref = globalFigureRef("waltz", "gf_unseeded_reconcile_regression");
    const stub = docs.get(docs.idFromName(ref));

    // Nothing seeded → snapshot null and zero rows in the change log.
    expect(await stub.getFigureSnapshot()).toBeNull();
    expect(await stub.debugChangeRowCount()).toBe(0);

    const { changed } = await stub.reconcileSeed({
      name: "Never Seeded",
      counts: 8,
      attributes: [],
    });
    expect(changed).toBe(false);

    // The bug persisted a bogus empty routine here; the fix persists nothing.
    expect(await stub.debugChangeRowCount()).toBe(0);
    expect(await stub.getFigureSnapshot()).toBeNull();
  });

  it("re-seeding is AUTHORITATIVE for seeded content but preserves user-added attributes (D30 ⟳)", async () => {
    const { seedGlobalFigures } = await import("./seed-global-figures");
    const family = "gf_reconcile_family";
    const ref = globalFigureRef("waltz", family);
    const s1 = {
      id: "fig-reconcile-s1-foot",
      kind: "footwork",
      count: 1,
      role: "leader" as const,
      value: "HT",
      deletedAt: null,
    };
    const s2 = {
      id: "fig-reconcile-s2-foot",
      kind: "footwork",
      count: 2,
      role: "leader" as const,
      value: "T",
      deletedAt: null,
    };
    // The doc also carries a user-added (ULID) attribute — attribute edits arrive
    // over the WS sync in production; here it ships in the initial doc content,
    // which is equivalent for the reconcile (it only owns fig-/wdsf- ids).
    const userAttr = {
      id: "01JUSERADDEDATTRIBUTE0000",
      kind: "sway",
      count: 1,
      role: "leader" as const,
      value: "to_L",
      deletedAt: null,
    };
    const base = {
      dance: "waltz" as const,
      figureType: family,
      name: "Reconcile Figure",
      timing: "1 2 3",
    };
    const v1: LibraryFigure[] = [{ ...base, attributes: [s1, s2, userAttr] }];
    await seedGlobalFigures(seedEnv, { figures: v1 });
    const stub = docs.get(docs.idFromName(ref));

    // The catalog is refined: s1 corrected to the book's "H flat", s2 dropped,
    // s3 added, and the figure renamed.
    const v2: LibraryFigure[] = [
      {
        ...base,
        name: "Reconcile Figure (Book)",
        attributes: [
          { ...s1, value: "H flat" }, // the seeded s1 row, corrected by the book
          {
            id: "fig-reconcile-s3-foot",
            kind: "footwork",
            count: 3,
            role: "leader",
            value: "TH",
            deletedAt: null,
          },
        ],
      },
    ];
    const run = await seedGlobalFigures(seedEnv, { figures: v2 });
    expect(run.created).toBe(0);
    expect(run.updated).toBe(1);

    const fig = (await stub.getFigureSnapshot()) as {
      name?: string;
      attributes?: Array<{ id: string; value?: unknown; deletedAt?: number | null }>;
    } | null;
    expect(fig?.name).toBe("Reconcile Figure (Book)");
    const byId = new Map((fig?.attributes ?? []).map((a) => [a.id, a]));
    expect(byId.get("fig-reconcile-s1-foot")?.value).toBe("H flat"); // corrected
    expect(byId.get("fig-reconcile-s3-foot")?.value).toBe("TH"); // added
    // Dropped seeded attribute is TOMBSTONED (soft-delete), never removed.
    expect(byId.get("fig-reconcile-s2-foot")?.deletedAt).not.toBeNull();
    // The user's own attribute survives untouched.
    expect(byId.get("01JUSERADDEDATTRIBUTE0000")?.value).toBe("to_L");
    // The registry row's display name follows the seed too.
    const row = await env.DB.prepare("SELECT title FROM document_registry WHERE docRef = ?")
      .bind(ref)
      .first<{ title: string }>();
    expect(row?.title).toBe("Reconcile Figure (Book)");
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

describe("ensureGlobalFigures — hash-guarded self-healing seed (D30 ⟳)", () => {
  // The catalog reconcile runs itself: a cheap app_meta hash check on the API
  // seam, the full seeder only when the bundled catalog actually changed (a
  // deploy with new seed content, a fresh environment, or a wiped D1).
  const family = "gf_ensure_family";
  const mk = (value: string, name = "Ensure Figure"): LibraryFigure[] => [
    {
      dance: "waltz",
      figureType: family,
      name,
      timing: "1 2 3",
      attributes: [
        {
          id: "fig-ensure-s1-foot",
          kind: "footwork",
          count: 1,
          role: "leader",
          value,
          deletedAt: null,
        },
      ],
    },
  ];

  it("seeds when the stored hash is absent, then short-circuits, then reconciles on change", async () => {
    const { ensureGlobalFigures } = await import("./seed-global-figures");
    const ref = globalFigureRef("waltz", family);

    // 1) Fresh environment: no hash row → the seeder runs and the hash persists.
    const first = await ensureGlobalFigures(seedEnv, { figures: mk("HT") });
    expect(first.ran).toBe(true);
    expect(first.result?.created).toBe(1);
    const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?")
      .bind("global_figure_seed_hash")
      .first<{ value: string }>();
    expect(row?.value).toBeTruthy();

    // 2) Same catalog: the hash matches → nothing runs (one PK SELECT, no writes).
    const second = await ensureGlobalFigures(seedEnv, { figures: mk("HT") });
    expect(second.ran).toBe(false);

    // 3) The catalog changes (a deploy with refined seed content): the hash
    //    differs → the reconcile runs and the doc follows the seed.
    const third = await ensureGlobalFigures(seedEnv, { figures: mk("H flat") });
    expect(third.ran).toBe(true);
    expect(third.result?.updated).toBe(1);
    const fig = (await docs.get(docs.idFromName(ref)).getFigureSnapshot()) as {
      attributes?: Array<{ id: string; value?: unknown }>;
    } | null;
    expect(fig?.attributes?.find((a) => a.id === "fig-ensure-s1-foot")?.value).toBe("H flat");
  });

  it("does not persist the hash when figures errored, so the next check retries", async () => {
    const { ensureGlobalFigures } = await import("./seed-global-figures");
    // Reset the stored hash so this test is order-independent.
    await env.DB.prepare("DELETE FROM app_meta WHERE key = ?")
      .bind("global_figure_seed_hash")
      .run();
    // An invalid figure makes the per-figure work throw → counted skipped; the
    // hash must NOT be written. An `undefined` name is the deterministic trigger:
    // createGlobalFigureRow's D1 `.bind(undefined)` rejects. (The previous
    // bad-dance fixture stopped erroring when Builder v3 ① switched the seeder
    // from defaultFigureBars(attrs, dance) to the dance-free defaultFigureCounts.)
    const bad = [{ ...mk("HT")[0], name: undefined as unknown as string }] as LibraryFigure[];
    const run = await ensureGlobalFigures(seedEnv, { figures: bad });
    expect(run.ran).toBe(true);
    expect((run.result?.skipped ?? 0) > 0).toBe(true);
    const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?")
      .bind("global_figure_seed_hash")
      .first<{ value: string }>();
    expect(row).toBeNull();
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
