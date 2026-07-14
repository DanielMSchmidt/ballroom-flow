import { env, runInDurableObject, SELF } from "cloudflare:test";
import * as A from "@automerge/automerge";
import { zRoutineList } from "@weavesteps/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { readFigureSnapshot } from "../figure-snapshot";
import { authedContext } from "../test-support/authed-context";
import { uniqueDocName } from "../test-support/do-id";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-037 — Choreo fork ("make it your own") [M4, user]
//
// PLAN §2.4, §4.1, §5.2: forking a routine yields an OWNED, independent copy (a
// new doc, no shared history) with `forkedFromRef` provenance; a later
// STRUCTURAL edit to the origin does NOT appear in the fork; the fork counts
// against the forker's quota. The domain primitive for the routine clone
// (cloneRoutine, US-007) is proven in packages/domain; this exercises the
// server fork endpoint end-to-end — INCLUDING the v5 figure-copy behavior
// below (a referenced ACCOUNT figure is copied for the forker so the fork is
// independent of the origin's later figure edits too; a GLOBAL/catalog ref
// stays live).
// ─────────────────────────────────────────────────────────────────────────

const docs = env.DOC_DO;
let kp: TestKeypair;

beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe("US-037 Choreo fork", () => {
  it("forks into an owned, independent copy with forkedFromRef + cloned content", async () => {
    // Intent: a member forks a routine → a new OWNED doc that carries the origin's
    //   content (cloned) and records its lineage, and is FROZEN from later origin edits.
    const owner = await authedContext({
      keypair: kp,
      userId: "u_fork_o",
      docRef: "n/a",
      role: null,
    });
    await seedDb({
      users: [{ id: "u_fork_o", displayName: "O", identityColor: "#111", plan: "free" }],
    });
    // Create the origin (server-seeds its content), then give it a section.
    const created = await SELF.fetch("https://x/api/routines", {
      method: "POST",
      headers: { ...owner.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ dance: "waltz", title: "Origin" }),
    });
    expect(created.status).toBe(201);
    const { docRef: originRef } = await created.json<{ docRef: string }>();
    await docs.get(docs.idFromName(originRef)).applyChange({ op: "addSection", name: "Intro" });

    // Fork it.
    const forkRes = await SELF.fetch(`https://x/api/routines/${originRef}/fork`, {
      method: "POST",
      headers: owner.authHeaders(),
    });
    expect(forkRes.status).toBe(201);
    const fork = await forkRes.json<{ docRef: string; forkedFromRef: string }>();
    expect(fork.forkedFromRef).toBe(originRef);
    expect(fork.docRef).not.toBe(originRef);

    // The fork is OWNED and appears in the forker's list.
    const list = await SELF.fetch("https://x/api/routines", { headers: owner.authHeaders() });
    const { routines } = zRoutineList.parse(await list.json());
    expect(routines).toContainEqual(
      expect.objectContaining({ docRef: fork.docRef, role: "owner" }),
    );

    // The fork's content was CLONED (the section came across).
    const forkSnap = await docs.get(docs.idFromName(fork.docRef)).getSnapshot();
    expect((forkSnap.sections ?? []).map((s) => s.name)).toContain("Intro");

    // FROZEN: a later edit to the ORIGIN does NOT appear in the fork.
    await docs.get(docs.idFromName(originRef)).applyChange({ op: "addSection", name: "AfterFork" });
    const forkNames = (
      (await docs.get(docs.idFromName(fork.docRef)).getSnapshot()).sections ?? []
    ).map((s) => s.name);
    expect(forkNames).toContain("Intro");
    expect(forkNames).not.toContain("AfterFork");
    // This case is the suite's heaviest: it cold-starts TWO Durable Objects
    // (origin + fork) and runs several Automerge ops + getSnapshots across them.
    // Under a cold CI workerd runner that can exceed vitest's default 5s, so give
    // it a larger budget (it runs in ~250ms warm) to avoid a cold-start flake.
  }, 15_000);

  it("forbids a non-member from forking (403)", async () => {
    // Intent: you can only fork a routine you can read; a stranger is refused.
    const stranger = await authedContext({
      keypair: kp,
      userId: "u_stranger",
      docRef: "rt_private",
      role: null,
    });
    await seedDb({
      users: [
        { id: "u_owner2", displayName: "O2", identityColor: "#222", plan: "free" },
        { id: "u_stranger", displayName: "S", identityColor: "#333", plan: "free" },
      ],
      docs: [{ docRef: "rt_private", type: "routine", ownerId: "u_owner2", doName: "rt_private" }],
    });
    const res = await SELF.fetch("https://x/api/routines/rt_private/fork", {
      method: "POST",
      headers: stranger.authHeaders(),
    });
    expect(res.status).toBe(403);
  });

  it("counts a fork against the forker's quota (402 at cap)", async () => {
    // Intent: a fork is a new OWNED routine, so the free 3-routine cap applies.
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_forkfull",
      docRef: "rt_src",
      role: "viewer",
    });
    await seedDb({
      users: [
        { id: "u_forkfull", displayName: "F", identityColor: "#111", plan: "free" },
        { id: "u_srcowner", displayName: "SO", identityColor: "#222", plan: "free" },
      ],
      docs: [
        ...[1, 2, 3].map((n) => ({
          docRef: `rt_ff_${n}`,
          type: "routine" as const,
          ownerId: "u_forkfull",
          doName: `rt_ff_${n}`,
        })),
        { docRef: "rt_src", type: "routine" as const, ownerId: "u_srcowner", doName: "rt_src" },
      ],
      memberships: ctx.membership ? [ctx.membership] : [],
    });
    const res = await SELF.fetch("https://x/api/routines/rt_src/fork", {
      method: "POST",
      headers: ctx.authHeaders(),
    });
    expect([402, 409]).toContain(res.status);
    expect(await res.json()).toMatchObject({ upsell: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// v5 fork — account figures are copied for the forker (PLAN §2.4/§5.2, D12
// ⟳v5, milestone §9 step 5). The fork must be independent of its ORIGIN, not
// just its routine content: a placement referencing an ACCOUNT figure is
// re-pointed at a fresh copy the forker owns (a variant copied AS a variant —
// `copyFigureForFork` keeps `baseFigureRef`, so catalog flow-in continues);
// a GLOBAL (catalog) reference, and a reference with no registry row at all,
// stay untouched. See apps/worker/src/fork.ts.
// ─────────────────────────────────────────────────────────────────────────

/** Seed an origin routine (owned by `ownerId`, with `ownerId` as an editor
 *  member so they can fork it) placing exactly one figure, and register +
 *  seed that figure per `figureType` (account-figure | global-figure | none —
 *  "none" skips the registry row entirely, modelling a dangling reference). */
async function seedOriginWithOnePlacement(opts: {
  ownerId: string;
  figureRegistryType: "account-figure" | "global-figure" | "none";
  figure: {
    ownerId: string;
    name: string;
    attributes: Array<{ id: string; kind: string; count: number; value: unknown }>;
    baseFigureRef?: string | null;
  };
}): Promise<{ originRef: string; figureRef: string; membership: SeedMembershipForTest }> {
  const originRef = uniqueDocName("rt_v5");
  const figureRef = uniqueDocName("fig_v5");
  const membership = {
    id: `mem_${opts.ownerId}_${originRef}`,
    docRef: originRef,
    userId: opts.ownerId,
    role: "editor" as const,
  };

  await seedDb({
    docs: [
      { docRef: originRef, type: "routine", ownerId: opts.ownerId, doName: originRef },
      ...(opts.figureRegistryType === "none"
        ? []
        : [
            {
              docRef: figureRef,
              type: opts.figureRegistryType,
              ownerId: opts.figure.ownerId,
              doName: figureRef,
              figureType: "feather",
              dance: "waltz",
              ...(opts.figure.baseFigureRef ? { forkedFromRef: opts.figure.baseFigureRef } : {}),
            },
          ]),
    ],
    memberships: [membership],
  });

  await docs.get(docs.idFromName(figureRef)).seedDoc({
    id: figureRef,
    scope: opts.figureRegistryType === "global-figure" ? "global" : "account",
    ownerId: opts.figure.ownerId,
    figureType: "feather",
    dance: "waltz",
    name: opts.figure.name,
    source: "custom",
    attributes: opts.figure.attributes.map((a) => ({ ...a, role: null, deletedAt: null })),
    ...(opts.figure.baseFigureRef ? { baseFigureRef: opts.figure.baseFigureRef } : {}),
    schemaVersion: 1,
    deletedAt: null,
  });

  await docs.get(docs.idFromName(originRef)).seedDoc({
    id: originRef,
    title: "Origin",
    dance: "waltz",
    ownerId: opts.ownerId,
    sections: [{ id: "s1", name: "Intro", placements: [{ id: "p1", figureRef, deletedAt: null }] }],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });

  return { originRef, figureRef, membership };
}

type SeedMembershipForTest = { id: string; docRef: string; userId: string; role: "editor" };

/**
 * Live-edit a figure DO's `name` via the real change-ingest path (mirrors the
 * "same saved figure" case in figures.test.ts): load the persisted change log,
 * replay it into an in-memory doc, produce a real Automerge change, and feed it
 * through `applyRawChange` (the US-015 sync entrypoint an editor's WebSocket
 * change hits). This is a genuine document mutation — NOT the `applyChange`
 * high-level-op RPC, whose `DocOp` union only covers routine-doc ops.
 */
async function editFigureNameForTest(figureRef: string, name: string): Promise<void> {
  const stub = docs.get(docs.idFromName(figureRef));
  await runInDurableObject(stub, async (instance, state) => {
    const rows = state.storage.sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM changes ORDER BY seq")
      .toArray();
    let doc = A.init<Record<string, unknown>>();
    [doc] = A.applyChanges(
      doc,
      rows.map((r) => new Uint8Array(r.data)),
    );
    const edited = A.change(doc, (d: Record<string, unknown>) => {
      d.name = name;
    });
    const changeBytes = A.getChanges(doc, edited);
    for (const ch of changeBytes) await instance.applyRawChange(ch);
  });
}

describe("v5 fork: account figures are copied for the forker", () => {
  it("copies a placed account figure into a NEW doc owned by the forker, with identical content", async () => {
    const forkerId = "u_v5_owner_a";
    const { originRef, figureRef } = await seedOriginWithOnePlacement({
      ownerId: forkerId,
      figureRegistryType: "account-figure",
      figure: {
        ownerId: forkerId,
        name: "My Feather",
        attributes: [{ id: "a1", kind: "direction", count: 1, value: "forward" }],
      },
    });
    await seedDb({
      users: [{ id: forkerId, displayName: "V5", identityColor: "#111", plan: "free" }],
    });
    const kpCtx = await authedContext({
      keypair: kp,
      userId: forkerId,
      docRef: originRef,
      role: "editor",
    });

    const forkRes = await SELF.fetch(`https://x/api/routines/${originRef}/fork`, {
      method: "POST",
      headers: kpCtx.authHeaders(),
    });
    expect(forkRes.status).toBe(201);
    const fork = await forkRes.json<{ docRef: string }>();

    const forkSnap = await docs.get(docs.idFromName(fork.docRef)).getSnapshot();
    const copyRef = forkSnap.sections[0]?.placements[0]?.figureRef;
    expect(copyRef).toBeDefined();
    if (!copyRef) throw new Error("expected the fork's placement to reference the copied figure");
    expect(copyRef).not.toBe(figureRef); // a NEW doc, not the origin's

    const copy = await readFigureSnapshot(docs.get(docs.idFromName(copyRef)));
    expect(copy?.ownerId).toBe(forkerId); // owned by the FORKER
    expect(copy?.name).toBe("My Feather");
    expect(copy?.attributes).toEqual([
      expect.objectContaining({ kind: "direction", count: 1, value: "forward" }),
    ]);

    // Placement edge for the new routine → the COPY (never the origin's figure),
    // so the fork's own members cascade to editor on it (§5.1).
    const edge = await env.DB.prepare(
      "SELECT 1 FROM placement_edge WHERE routineRef = ?1 AND figureRef = ?2",
    )
      .bind(fork.docRef, copyRef)
      .first();
    expect(edge).toBeTruthy();
  });

  it("is independent of the origin: a later edit to the ORIGIN figure does not appear in the fork's copy", async () => {
    const forkerId = "u_v5_owner_b";
    const { originRef, figureRef } = await seedOriginWithOnePlacement({
      ownerId: forkerId,
      figureRegistryType: "account-figure",
      figure: {
        ownerId: forkerId,
        name: "My Feather",
        attributes: [{ id: "a1", kind: "direction", count: 1, value: "forward" }],
      },
    });
    await seedDb({
      users: [{ id: forkerId, displayName: "V5", identityColor: "#111", plan: "free" }],
    });
    const kpCtx = await authedContext({
      keypair: kp,
      userId: forkerId,
      docRef: originRef,
      role: "editor",
    });

    const forkRes = await SELF.fetch(`https://x/api/routines/${originRef}/fork`, {
      method: "POST",
      headers: kpCtx.authHeaders(),
    });
    const fork = await forkRes.json<{ docRef: string }>();
    const forkSnap = await docs.get(docs.idFromName(fork.docRef)).getSnapshot();
    const copyRef = forkSnap.sections[0]?.placements[0]?.figureRef;
    if (!copyRef) throw new Error("expected the fork's placement to reference the copied figure");

    // A LIVE edit to the ORIGIN figure, via the real change-ingest path.
    await editFigureNameForTest(figureRef, "My Feather (edited after fork)");
    const originFigureAfter = await readFigureSnapshot(docs.get(docs.idFromName(figureRef)));
    expect(originFigureAfter?.name).toBe("My Feather (edited after fork)");

    const copyAfter = await readFigureSnapshot(docs.get(docs.idFromName(copyRef)));
    // The copy is untouched by the origin's later edit (v5 independence point).
    expect(copyAfter?.name).toBe("My Feather");
  });

  it("copies a variant AS a variant, keeping baseFigureRef so catalog flow-in continues", async () => {
    const forkerId = "u_v5_owner_c";
    const baseRef = uniqueDocName("fig_base_v5");
    // The variant is owned by SOMEONE ELSE (the routine's original creator) —
    // the common fork case: the forker doesn't yet own a derivative of `baseRef`.
    const { originRef, figureRef } = await seedOriginWithOnePlacement({
      ownerId: forkerId,
      figureRegistryType: "account-figure",
      figure: {
        ownerId: "u_variant_source",
        name: "My Passing Variant",
        attributes: [{ id: "a1", kind: "direction", count: 4, value: "back" }],
        baseFigureRef: baseRef,
      },
    });
    await seedDb({
      users: [
        { id: forkerId, displayName: "V5", identityColor: "#111", plan: "free" },
        { id: "u_variant_source", displayName: "VS", identityColor: "#222", plan: "free" },
      ],
    });
    const kpCtx = await authedContext({
      keypair: kp,
      userId: forkerId,
      docRef: originRef,
      role: "editor",
    });

    const forkRes = await SELF.fetch(`https://x/api/routines/${originRef}/fork`, {
      method: "POST",
      headers: kpCtx.authHeaders(),
    });
    const fork = await forkRes.json<{ docRef: string }>();
    const forkSnap = await docs.get(docs.idFromName(fork.docRef)).getSnapshot();
    const copyRef = forkSnap.sections[0]?.placements[0]?.figureRef;
    if (!copyRef) throw new Error("expected the fork's placement to reference the copied variant");
    expect(copyRef).not.toBe(figureRef);

    const copy = await readFigureSnapshot(docs.get(docs.idFromName(copyRef)));
    expect(copy?.ownerId).toBe(forkerId); // owned by the FORKER
    expect(copy?.baseFigureRef).toBe(baseRef); // still a variant of the SAME base
  });

  it("mints an INDEPENDENT copy when the forker already owns a derivative of the same base (many variants per base — migration 0017)", async () => {
    // The forker ALREADY owns a variant of `baseRef` (from unrelated prior
    // activity — e.g. a variant-spawn in a different routine). The origin
    // places a DIFFERENT figure that is ALSO a variant of the SAME base, owned
    // by someone else. Pre-#0017 a fresh copy collided with the (owner, base)
    // unique index and the fork REUSED the pre-existing derivative. That index
    // was wrong (it silently broke variant-on-edit — see migration 0017), so a
    // user may now own MANY derivatives of the same base: the fork mints a fresh
    // INDEPENDENT copy, and the pre-existing variant is left untouched.
    const forkerId = "u_v5_owner_f";
    const baseRef = uniqueDocName("fig_base_v5f");
    const myExistingVariantRef = uniqueDocName("fig_mine_v5f");

    await seedDb({
      users: [
        { id: forkerId, displayName: "V5", identityColor: "#111", plan: "free" },
        { id: "u_variant_source2", displayName: "VS2", identityColor: "#222", plan: "free" },
      ],
      docs: [
        {
          docRef: myExistingVariantRef,
          type: "account-figure",
          ownerId: forkerId,
          doName: myExistingVariantRef,
          figureType: "feather",
          dance: "waltz",
          forkedFromRef: baseRef,
        },
      ],
    });
    await docs.get(docs.idFromName(myExistingVariantRef)).seedDoc({
      id: myExistingVariantRef,
      scope: "account",
      ownerId: forkerId,
      figureType: "feather",
      dance: "waltz",
      name: "My Own Variant",
      source: "custom",
      attributes: [
        { id: "m1", kind: "direction", count: 1, role: null, value: "side", deletedAt: null },
      ],
      baseFigureRef: baseRef,
      schemaVersion: 1,
      deletedAt: null,
    });

    const { originRef, figureRef } = await seedOriginWithOnePlacement({
      ownerId: forkerId,
      figureRegistryType: "account-figure",
      figure: {
        ownerId: "u_variant_source2",
        name: "Someone Else's Variant",
        attributes: [{ id: "a1", kind: "direction", count: 4, value: "back" }],
        baseFigureRef: baseRef,
      },
    });
    const kpCtx = await authedContext({
      keypair: kp,
      userId: forkerId,
      docRef: originRef,
      role: "editor",
    });

    const forkRes = await SELF.fetch(`https://x/api/routines/${originRef}/fork`, {
      method: "POST",
      headers: kpCtx.authHeaders(),
    });
    expect(forkRes.status).toBe(201); // no 409/500 — a second derivative is allowed now
    const fork = await forkRes.json<{ docRef: string }>();

    const forkSnap = await docs.get(docs.idFromName(fork.docRef)).getSnapshot();
    const copyRef = forkSnap.sections[0]?.placements[0]?.figureRef;
    if (!copyRef) throw new Error("expected the fork's placement to reference the fresh copy");
    expect(copyRef).not.toBe(figureRef); // re-pointed away from the shared origin figure
    expect(copyRef).not.toBe(myExistingVariantRef); // a FRESH independent copy, not a reuse

    // Both derivatives of the same base now coexist, both owned by the forker —
    // the (owner, base) uniqueness that used to forbid this is gone.
    const copyRow = await env.DB.prepare(
      "SELECT ownerId, type, forkedFromRef FROM document_registry WHERE docRef = ?",
    )
      .bind(copyRef)
      .first<{ ownerId: string; type: string; forkedFromRef: string | null }>();
    expect(copyRow).toMatchObject({
      ownerId: forkerId,
      type: "account-figure",
      forkedFromRef: baseRef,
    });
    const derivatives = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE ownerId = ? AND forkedFromRef = ? AND deletedAt IS NULL",
    )
      .bind(forkerId, baseRef)
      .first<{ n: number }>();
    expect(derivatives?.n).toBe(2); // the pre-existing variant + the fresh fork copy
  });

  it("leaves a GLOBAL figure reference untouched (placement keeps pointing at the catalog doc)", async () => {
    const forkerId = "u_v5_owner_d";
    const { originRef, figureRef } = await seedOriginWithOnePlacement({
      ownerId: forkerId,
      figureRegistryType: "global-figure",
      figure: {
        ownerId: "app",
        name: "Feather Step",
        attributes: [{ id: "a1", kind: "direction", count: 1, value: "forward" }],
      },
    });
    await seedDb({
      users: [{ id: forkerId, displayName: "V5", identityColor: "#111", plan: "free" }],
    });
    const kpCtx = await authedContext({
      keypair: kp,
      userId: forkerId,
      docRef: originRef,
      role: "editor",
    });

    const forkRes = await SELF.fetch(`https://x/api/routines/${originRef}/fork`, {
      method: "POST",
      headers: kpCtx.authHeaders(),
    });
    expect(forkRes.status).toBe(201);
    const fork = await forkRes.json<{ docRef: string }>();

    const forkSnap = await docs.get(docs.idFromName(fork.docRef)).getSnapshot();
    // The GLOBAL ref stays live — the fork's placement is untouched.
    expect(forkSnap.sections[0]?.placements[0]?.figureRef).toBe(figureRef);

    // No copy was minted, so no placement edge either — global figures are
    // implicit-viewer for everyone and admin-write-only regardless of cascade.
    const edge = await env.DB.prepare(
      "SELECT 1 FROM placement_edge WHERE routineRef = ?1 AND figureRef = ?2",
    )
      .bind(fork.docRef, figureRef)
      .first();
    expect(edge).toBeFalsy();
  });

  it("leaves a figure reference with no registry row untouched (dangling/legacy ref)", async () => {
    const forkerId = "u_v5_owner_e";
    const { originRef, figureRef } = await seedOriginWithOnePlacement({
      ownerId: forkerId,
      figureRegistryType: "none",
      figure: {
        ownerId: forkerId,
        name: "Unregistered",
        attributes: [{ id: "a1", kind: "direction", count: 1, value: "forward" }],
      },
    });
    await seedDb({
      users: [{ id: forkerId, displayName: "V5", identityColor: "#111", plan: "free" }],
    });
    const kpCtx = await authedContext({
      keypair: kp,
      userId: forkerId,
      docRef: originRef,
      role: "editor",
    });

    const forkRes = await SELF.fetch(`https://x/api/routines/${originRef}/fork`, {
      method: "POST",
      headers: kpCtx.authHeaders(),
    });
    expect(forkRes.status).toBe(201);
    const fork = await forkRes.json<{ docRef: string }>();

    const forkSnap = await docs.get(docs.idFromName(fork.docRef)).getSnapshot();
    expect(forkSnap.sections[0]?.placements[0]?.figureRef).toBe(figureRef);
  });
});
