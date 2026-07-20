import { env, SELF } from "cloudflare:test";
import { zTranscribeResponse, zVoiceNoteProposal } from "@weavesteps/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { uniqueDocName } from "../test-support/do-id";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// POST /api/voice-notes/interpret and /transcribe — the READ-ONLY voice-note
// routes (docs/concepts/annotations.md § The Journal, docs/system/architecture.md).
// The worker assembles the caller's in-scope choreography, calls the DETERMINISTIC
// fixture VoiceAi seam (no `AI` binding, no secrets), re-validates + grounds the
// output, and returns a schema-valid proposal. The AI NEVER writes — this suite
// snapshots the D1 row counts before/after to prove the routes touch nothing.
//
// Runs in real workerd (D1 + per-document DO + the fail-closed auth boundary).
// ─────────────────────────────────────────────────────────────────────────

const docs = env.DOC_DO;

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

/** Seed a foxtrot routine owned by `ownerId` placing one figure per (figureRef,figureType,name). */
async function seedFoxtrotRoutine(opts: {
  routineRef: string;
  title: string;
  ownerId: string;
  figures: { figureRef: string; figureType: string; name: string }[];
}): Promise<void> {
  await seedDb({
    users: [{ id: opts.ownerId, displayName: "O", identityColor: "#111", plan: "free" }],
    docs: [
      {
        docRef: opts.routineRef,
        type: "routine",
        ownerId: opts.ownerId,
        doName: opts.routineRef,
        dance: "foxtrot",
        title: opts.title,
      },
      ...opts.figures.map((f) => ({
        docRef: f.figureRef,
        type: "account-figure" as const,
        ownerId: opts.ownerId,
        doName: f.figureRef,
        dance: "foxtrot",
        figureType: f.figureType,
      })),
    ],
    placementEdges: opts.figures.map((f) => ({
      routineRef: opts.routineRef,
      figureRef: f.figureRef,
    })),
  });
  await docs.get(docs.idFromName(opts.routineRef)).seedDoc({
    id: opts.routineRef,
    title: opts.title,
    dance: "foxtrot",
    ownerId: opts.ownerId,
    sections: [
      {
        id: `s_${opts.routineRef}`,
        name: "Part 1",
        placements: opts.figures.map((f, i) => ({
          id: `p_${f.figureRef}`,
          figureRef: f.figureRef,
          sortKey: `a${i}`,
          deletedAt: null,
        })),
      },
    ],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });
  for (const f of opts.figures) {
    await docs.get(docs.idFromName(f.figureRef)).seedDoc({
      id: f.figureRef,
      scope: "account",
      ownerId: opts.ownerId,
      figureType: f.figureType,
      dance: "foxtrot",
      name: f.name,
      source: "custom",
      attributes: [
        {
          id: `a_${f.figureRef}`,
          kind: "sway",
          count: 1,
          role: null,
          value: "left",
          deletedAt: null,
        },
      ],
      schemaVersion: 1,
      deletedAt: null,
    });
  }
}

async function countRows(): Promise<{ registry: number; journal: number; familyNote: number }> {
  const registry = await env.DB.prepare("SELECT COUNT(*) AS n FROM document_registry").first<{
    n: number;
  }>();
  const journal = await env.DB.prepare("SELECT COUNT(*) AS n FROM journal_entry").first<{
    n: number;
  }>();
  const familyNote = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM figure_type_note_index",
  ).first<{ n: number }>();
  return {
    registry: registry?.n ?? 0,
    journal: journal?.n ?? 0,
    familyNote: familyNote?.n ?? 0,
  };
}

describe("POST /api/voice-notes/interpret", () => {
  it("401s an unauthenticated request", async () => {
    const res = await SELF.fetch("https://x/api/voice-notes/interpret", {
      method: "POST",
      body: JSON.stringify({ transcript: "hi" }),
    });
    expect(res.status).toBe(401);
  });

  it("400s a malformed body", async () => {
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_vn_bad",
      docRef: uniqueDocName("rt"),
      role: null,
    });
    const res = await SELF.fetch("https://x/api/voice-notes/interpret", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ transcript: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("scenario A: resolves a slowfox+feather transcript to a figureType/foxtrot proposal", async () => {
    const owner = "u_vn_a";
    const rtA = uniqueDocName("rt_fox_a");
    const rtB = uniqueDocName("rt_fox_b");
    const featherA = uniqueDocName("fig_feather_a");
    const featherB = uniqueDocName("fig_feather_b");
    await seedFoxtrotRoutine({
      routineRef: rtA,
      title: "Foxtrot A",
      ownerId: owner,
      figures: [{ figureRef: featherA, figureType: "feather", name: "Feather Step" }],
    });
    await seedFoxtrotRoutine({
      routineRef: rtB,
      title: "Foxtrot B",
      ownerId: owner,
      figures: [{ figureRef: featherB, figureType: "feather", name: "Feather Step" }],
    });
    const ctx = await authedContext({ keypair: kp, userId: owner, docRef: rtA, role: null });

    const before = await countRows();
    const res = await SELF.fetch("https://x/api/voice-notes/interpret", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        transcript:
          "In Slowfox, in Feather Steps, I need to settle the sway before the Three Step.",
      }),
    });
    expect(res.status).toBe(200);
    // The contract IS the assertion: a malformed body throws here.
    const proposal = zVoiceNoteProposal.parse(await res.json());
    expect(proposal.resolved).toBe(true);
    expect(proposal.proposed?.anchor.type).toBe("figureType");
    if (proposal.proposed?.anchor.type === "figureType") {
      expect(proposal.proposed.anchor.figureType).toBe("feather");
      expect(proposal.proposed.anchor.danceScope).toBe("foxtrot");
    }
    // READ-ONLY: no D1 row minted.
    expect(await countRows()).toEqual(before);
  });

  it("scenario B: resolves an ordinal bounce fallaway to the EARLIEST figure anchor", async () => {
    const owner = "u_vn_b";
    const rt = uniqueDocName("rt_comp");
    const bounce1 = uniqueDocName("fig_bounce1");
    const bounce2 = uniqueDocName("fig_bounce2");
    await seedFoxtrotRoutine({
      routineRef: rt,
      title: "Comp Slowfox",
      ownerId: owner,
      figures: [
        { figureRef: bounce1, figureType: "bounce_fallaway", name: "Bounce Fallaway" },
        { figureRef: bounce2, figureType: "bounce_fallaway", name: "Bounce Fallaway" },
      ],
    });
    const ctx = await authedContext({ keypair: kp, userId: owner, docRef: rt, role: null });

    const res = await SELF.fetch("https://x/api/voice-notes/interpret", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        transcript:
          "In my competition slowfox, on the first bounce fallaway, I need to change the direction to go more diagonal.",
      }),
    });
    expect(res.status).toBe(200);
    const proposal = zVoiceNoteProposal.parse(await res.json());
    expect(proposal.resolved).toBe(true);
    expect(proposal.proposed?.anchor.type).toBe("figure");
    if (proposal.proposed?.anchor.type === "figure") {
      expect(proposal.proposed.anchor.figureRef).toBe(bounce1);
    }
    expect(proposal.proposed?.routineRef).toBe(rt);
  });

  it("scenario C: an unresolvable transcript → resolved:false, noteText = transcript", async () => {
    const owner = "u_vn_c";
    const rt = uniqueDocName("rt_fox_c");
    const feather = uniqueDocName("fig_feather_c");
    await seedFoxtrotRoutine({
      routineRef: rt,
      title: "Foxtrot C",
      ownerId: owner,
      figures: [{ figureRef: feather, figureType: "feather", name: "Feather Step" }],
    });
    const ctx = await authedContext({ keypair: kp, userId: owner, docRef: rt, role: null });
    const res = await SELF.fetch("https://x/api/voice-notes/interpret", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ transcript: "Remember to breathe and stay grounded." }),
    });
    expect(res.status).toBe(200);
    const proposal = zVoiceNoteProposal.parse(await res.json());
    expect(proposal.resolved).toBe(false);
    expect(proposal.proposed).toBeNull();
    expect(proposal.noteText).toBe("Remember to breathe and stay grounded.");
  });

  it("does NOT resolve against a routine the caller is only a VIEWER of", async () => {
    const other = "u_vn_owner_v";
    const viewer = "u_vn_viewer";
    const rt = uniqueDocName("rt_fox_v");
    const feather = uniqueDocName("fig_feather_v");
    await seedFoxtrotRoutine({
      routineRef: rt,
      title: "Someone's Foxtrot",
      ownerId: other,
      figures: [{ figureRef: feather, figureType: "feather", name: "Feather Step" }],
    });
    // The viewer has a viewer membership on that routine — annotate-incapable.
    const ctx = await authedContext({ keypair: kp, userId: viewer, docRef: rt, role: "viewer" });
    await seedDb({
      users: [{ id: viewer, displayName: "V", identityColor: "#222", plan: "free" }],
      memberships: ctx.membership ? [ctx.membership] : [],
    });
    const res = await SELF.fetch("https://x/api/voice-notes/interpret", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        transcript: "In Slowfox, in Feather Steps, settle the sway.",
      }),
    });
    expect(res.status).toBe(200);
    const proposal = zVoiceNoteProposal.parse(await res.json());
    // The feather is out of the viewer's annotate scope → nothing to resolve.
    expect(proposal.resolved).toBe(false);
  });
});

describe("POST /api/voice-notes/transcribe", () => {
  it("echoes the UTF-8 bytes as { transcript } (fixture) and stays read-only", async () => {
    const owner = "u_vn_t";
    const rt = uniqueDocName("rt_fox_t");
    const feather = uniqueDocName("fig_feather_t");
    await seedFoxtrotRoutine({
      routineRef: rt,
      title: "Foxtrot T",
      ownerId: owner,
      figures: [{ figureRef: feather, figureType: "feather", name: "Feather Step" }],
    });
    const ctx = await authedContext({ keypair: kp, userId: owner, docRef: rt, role: null });
    const before = await countRows();
    const res = await SELF.fetch("https://x/api/voice-notes/transcribe", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/octet-stream" },
      body: new TextEncoder().encode("in slowfox settle the sway"),
    });
    expect(res.status).toBe(200);
    const body = zTranscribeResponse.parse(await res.json());
    expect(body.transcript).toBe("in slowfox settle the sway");
    expect(await countRows()).toEqual(before);
  });

  it("413s an oversized audio body", async () => {
    const ctx = await authedContext({
      keypair: kp,
      userId: "u_vn_big",
      docRef: uniqueDocName("rt"),
      role: null,
    });
    const res = await SELF.fetch("https://x/api/voice-notes/transcribe", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/octet-stream" },
      body: new Uint8Array(4 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
  });

  it("401s an unauthenticated transcribe", async () => {
    const res = await SELF.fetch("https://x/api/voice-notes/transcribe", {
      method: "POST",
      body: new TextEncoder().encode("x"),
    });
    expect(res.status).toBe(401);
  });
});
