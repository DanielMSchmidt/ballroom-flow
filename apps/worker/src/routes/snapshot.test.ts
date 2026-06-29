import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { uniqueDocName } from "../test-support/do-id";
import type { DocNamespace } from "../test-support/doc-do-api";
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

const docs = env.DOC_DO as unknown as DocNamespace;

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
    const body = (await res.json()) as {
      routine: { title: string; sections: { placements: { figureRef: string }[] }[] };
      figures: Record<string, { name: string; attributes: { value: string }[] }>;
    };
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
      docs: [{ docRef: routineRef, type: "routine", ownerId: "u_var_m", doName: routineRef }],
      memberships: [
        { id: `mem_${routineRef}`, docRef: routineRef, userId: "u_var_m", role: "editor" },
      ],
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
    const body = (await res.json()) as {
      figures: Record<
        string,
        { id: string; baseFigureRef?: string; attributes: { id: string; value: string }[] }
      >;
    };
    const resolved = body.figures[variantRef];
    // The copy keeps its own identity, provenance ref, and OWN attributes (a1 → "T").
    expect(resolved?.id).toBe(variantRef);
    expect(resolved?.baseFigureRef).toBe(baseRef);
    expect(resolved?.attributes.find((a) => a.id === "a1")?.value).toBe("T");
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
