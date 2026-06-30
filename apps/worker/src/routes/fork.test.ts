import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import type { DocNamespace } from "../test-support/doc-do-api";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// US-037 — Choreo fork ("make it your own") [M4, user]
//
// PLAN §2.4, §4.1, §5.2: forking a routine yields an OWNED, FROZEN, independent
// copy (a new doc) with `forkedFromRef` provenance; a later edit to the origin
// does NOT appear in the fork; referenced figures stay shared; the fork counts
// against the forker's quota. The domain primitive (cloneRoutine, US-007) is
// proven in packages/domain; this exercises the server fork endpoint end-to-end.
// ─────────────────────────────────────────────────────────────────────────

const docs = env.DOC_DO as unknown as DocNamespace;
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
    const { docRef: originRef } = (await created.json()) as { docRef: string };
    await docs.get(docs.idFromName(originRef)).applyChange({ op: "addSection", name: "Intro" });

    // Fork it.
    const forkRes = await SELF.fetch(`https://x/api/routines/${originRef}/fork`, {
      method: "POST",
      headers: owner.authHeaders(),
    });
    expect(forkRes.status).toBe(201);
    const fork = (await forkRes.json()) as { docRef: string; forkedFromRef: string };
    expect(fork.forkedFromRef).toBe(originRef);
    expect(fork.docRef).not.toBe(originRef);

    // The fork is OWNED and appears in the forker's list.
    const list = await SELF.fetch("https://x/api/routines", { headers: owner.authHeaders() });
    const { routines } = (await list.json()) as {
      routines: Array<{ docRef: string; role: string }>;
    };
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
