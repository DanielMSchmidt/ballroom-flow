import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { uniqueDocName } from "../test-support/do-id";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// GET /api/routines/:id/snapshot — the READ-ONLY snapshot path (read/edit split).
// One REST read hydrates a routine + ALL its referenced figures (each carrying
// its own attributes — frozen copies, no overlay) with NO per-document
// WebSocket — the common "I'm just
// reading" case, at one request and zero persistent sockets. Gated like /access:
// a non-member 403s. The live WS sync (US-021 boundary) stays the EDIT path.
// ─────────────────────────────────────────────────────────────────────────

const docs = env.DOC_DO;

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe("GET /api/routines/:id/snapshot", () => {
  it("returns the routine + its referenced figures resolved, for a member", async () => {
    const routineRef = uniqueDocName("rt_snap");
    const figRef = uniqueDocName("fig_snap");
    const member = await authedContext({
      keypair: kp,
      userId: "u_snap_m",
      docRef: routineRef,
      role: "viewer",
    });
    await seedDb({
      users: [{ id: "u_snap_m", displayName: "M", identityColor: "#111", plan: "free" }],
      docs: [{ docRef: routineRef, type: "routine", ownerId: "u_owner", doName: routineRef }],
      memberships: [
        { id: `mem_${routineRef}`, docRef: routineRef, userId: "u_snap_m", role: "viewer" },
      ],
      // The placement_edge is what production mints when a figure is added to a
      // routine (linkPlacement); it's the row the read-access cascade reads, so a
      // routine member can read the figures the routine legitimately references.
      placementEdges: [{ routineRef, figureRef: figRef }],
    });
    // Seed the routine DO with a section referencing the figure…
    await docs.get(docs.idFromName(routineRef)).seedDoc({
      id: routineRef,
      title: "Gold Waltz",
      dance: "waltz",
      ownerId: "u_owner",
      sections: [
        {
          id: "s1",
          name: "Part 1",
          placements: [{ id: "p1", figureRef: figRef, deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    // …and the figure DO with its content.
    await docs.get(docs.idFromName(figRef)).seedDoc({
      id: figRef,
      scope: "account",
      ownerId: "u_owner",
      figureType: "natural-turn",
      dance: "waltz",
      name: "Natural Turn",
      source: "custom",
      attributes: [
        { id: "a1", kind: "direction", count: 1, role: null, value: "forward", deletedAt: null },
      ],
      schemaVersion: 1,
      deletedAt: null,
    });

    const res = await SELF.fetch(`https://x/api/routines/${routineRef}/snapshot`, {
      headers: member.authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{
      routine: { title: string; sections: { placements: { figureRef: string }[] }[] };
      figures: Record<string, { name: string; attributes: { value: string }[] }>;
    }>();
    expect(body.routine.title).toBe("Gold Waltz");
    expect(body.routine.sections[0]?.placements[0]?.figureRef).toBe(figRef);
    expect(body.figures[figRef]?.name).toBe("Natural Turn");
    expect(body.figures[figRef]?.attributes[0]?.value).toBe("forward");
  });

  it("returns a copy figure's OWN attributes (frozen snapshot, no base resolution)", async () => {
    // A copy-on-write figure is a FROZEN snapshot carrying its own attributes;
    // `baseFigureRef` is provenance only — the snapshot route does NOT resolve
    // against the base (§5.2). So the copy's edited value comes straight from its
    // own doc, even if the base still carries the original value.
    const routineRef = uniqueDocName("rt_var");
    const baseRef = uniqueDocName("fig_base");
    const variantRef = uniqueDocName("fig_var");
    const member = await authedContext({
      keypair: kp,
      userId: "u_var_m",
      docRef: routineRef,
      role: "editor",
    });
    await seedDb({
      users: [{ id: "u_var_m", displayName: "V", identityColor: "#111", plan: "free" }],
      docs: [
        { docRef: routineRef, type: "routine", ownerId: "u_var_m", doName: routineRef },
        // The base is a world-readable global catalog doc — resolves to `viewer`
        // for any signed-in user (the snapshot's per-figure access gate).
        { docRef: baseRef, type: "global-figure", ownerId: "app", doName: baseRef },
      ],
      memberships: [
        { id: `mem_${routineRef}`, docRef: routineRef, userId: "u_var_m", role: "editor" },
      ],
      // The account variant is reachable via the routine's placement edge (as in
      // production — linkPlacement mints it when the figure is added).
      placementEdges: [{ routineRef, figureRef: variantRef }],
    });
    await docs.get(docs.idFromName(routineRef)).seedDoc({
      id: routineRef,
      title: "R",
      dance: "foxtrot",
      ownerId: "u_var_m",
      sections: [
        {
          id: "s1",
          name: "S",
          placements: [{ id: "p1", figureRef: variantRef, deletedAt: null }],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    // Base figure still carries the ORIGINAL attribute (id a1, value HT). A later
    // edit to the base must never reach the frozen copy.
    await docs.get(docs.idFromName(baseRef)).seedDoc({
      id: baseRef,
      scope: "global",
      ownerId: "app",
      figureType: "feather",
      dance: "foxtrot",
      name: "Feather",
      source: "library",
      attributes: [
        { id: "a1", kind: "footwork", count: 1, role: null, value: "HT", deletedAt: null },
      ],
      schemaVersion: 1,
      deletedAt: null,
    });
    // The frozen copy carries its OWN edited attributes (a1 → "T"); baseFigureRef
    // is provenance only.
    await docs.get(docs.idFromName(variantRef)).seedDoc({
      id: variantRef,
      scope: "account",
      ownerId: "u_var_m",
      figureType: "feather",
      dance: "foxtrot",
      name: "My Feather",
      source: "custom",
      attributes: [
        { id: "a1", kind: "footwork", count: 1, role: null, value: "T", deletedAt: null },
      ],
      baseFigureRef: baseRef,
      schemaVersion: 1,
      deletedAt: null,
    });

    const res = await SELF.fetch(`https://x/api/routines/${routineRef}/snapshot`, {
      headers: member.authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{
      figures: Record<
        string,
        { id: string; baseFigureRef?: string; attributes: { id: string; value: string }[] }
      >;
    }>();
    const resolved = body.figures[variantRef];
    // The copy keeps its own identity, provenance ref, and OWN attributes (a1 → "T").
    expect(resolved?.id).toBe(variantRef);
    expect(resolved?.baseFigureRef).toBe(baseRef);
    expect(resolved?.attributes.find((a) => a.id === "a1")?.value).toBe("T");
  });

  it("does NOT leak a figure the caller can't read, even when their own routine references it", async () => {
    // Security (per-figure authz): a routine's placements are caller-controlled
    // CRDT content, so a caller can add a placement pointing at ANY figure docRef
    // they've learned. The snapshot must gate each referenced figure on the caller's
    // OWN access — never trust the routine's ref list — or it leaks any figure whose
    // ref an authenticated user can obtain (defeating cascade revocation).
    const attackerRoutine = uniqueDocName("rt_attacker");
    const victimFigure = uniqueDocName("fig_victim");
    const okFigure = uniqueDocName("fig_ok");
    const attacker = await authedContext({
      keypair: kp,
      userId: "u_attacker",
      docRef: attackerRoutine,
      role: "editor",
    });
    await seedDb({
      users: [
        { id: "u_attacker", displayName: "A", identityColor: "#111", plan: "free" },
        { id: "u_victim", displayName: "Vic", identityColor: "#222", plan: "free" },
      ],
      // The attacker owns their routine. victimFigure is a PRIVATE account figure
      // owned by someone else — the attacker has no membership, no ownership, and
      // (crucially) NO placement_edge for it. okFigure is one the attacker legitimately
      // owns/references (edge minted), so the snapshot still returns the real ones.
      docs: [
        {
          docRef: attackerRoutine,
          type: "routine",
          ownerId: "u_attacker",
          doName: attackerRoutine,
        },
        { docRef: victimFigure, type: "account-figure", ownerId: "u_victim", doName: victimFigure },
        { docRef: okFigure, type: "account-figure", ownerId: "u_attacker", doName: okFigure },
      ],
      memberships: [
        {
          id: `mem_${attackerRoutine}`,
          docRef: attackerRoutine,
          userId: "u_attacker",
          role: "editor",
        },
      ],
      placementEdges: [{ routineRef: attackerRoutine, figureRef: okFigure }],
    });
    await docs.get(docs.idFromName(attackerRoutine)).seedDoc({
      id: attackerRoutine,
      title: "Mine",
      dance: "waltz",
      ownerId: "u_attacker",
      sections: [
        {
          id: "s1",
          name: "S",
          // The attacker has injected the victim's private figure ref alongside a
          // legitimate one.
          placements: [
            { id: "p1", figureRef: okFigure, deletedAt: null },
            { id: "p2", figureRef: victimFigure, deletedAt: null },
          ],
        },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    await docs.get(docs.idFromName(okFigure)).seedDoc({
      id: okFigure,
      scope: "account",
      ownerId: "u_attacker",
      figureType: "natural-turn",
      dance: "waltz",
      name: "Mine",
      source: "custom",
      attributes: [
        { id: "a1", kind: "direction", count: 1, role: null, value: "forward", deletedAt: null },
      ],
      schemaVersion: 1,
      deletedAt: null,
    });
    await docs.get(docs.idFromName(victimFigure)).seedDoc({
      id: victimFigure,
      scope: "account",
      ownerId: "u_victim",
      figureType: "whisk",
      dance: "waltz",
      name: "Victim Secret",
      source: "custom",
      attributes: [
        { id: "a1", kind: "direction", count: 1, role: null, value: "side", deletedAt: null },
      ],
      schemaVersion: 1,
      deletedAt: null,
    });

    const res = await SELF.fetch(`https://x/api/routines/${attackerRoutine}/snapshot`, {
      headers: attacker.authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ figures: Record<string, { name: string }> }>();
    // The legitimately-referenced figure is present…
    expect(body.figures[okFigure]?.name).toBe("Mine");
    // …but the victim's private figure is NOT leaked, despite the injected placement.
    expect(body.figures[victimFigure]).toBeUndefined();
  });

  it("forbids a non-member (403)", async () => {
    const routineRef = uniqueDocName("rt_denied");
    const stranger = await authedContext({
      keypair: kp,
      userId: "u_snap_x",
      docRef: routineRef,
      role: null,
    });
    await seedDb({
      users: [{ id: "u_snap_x", displayName: "X", identityColor: "#111", plan: "free" }],
      docs: [{ docRef: routineRef, type: "routine", ownerId: "u_other", doName: routineRef }],
    });
    const res = await SELF.fetch(`https://x/api/routines/${routineRef}/snapshot`, {
      headers: stranger.authHeaders(),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request (401)", async () => {
    const res = await SELF.fetch("https://x/api/routines/rt_any/snapshot");
    expect(res.status).toBe(401);
  });
});
