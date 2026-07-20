// Context-first note capture (docs/concepts/annotations.md § Voice capture) — the
// dance-scoped grounding of POST /api/voice-notes/interpret. When the caller
// scopes a note to a DANCE, assembleVoiceContext narrows the grounding context to
// their annotate-capable choreos of THAT dance before serializing; absent → the
// broad (all annotate-capable choreos) behavior. Per-figure authorization is
// unchanged and the route stays READ-ONLY (no D1/DO/CRDT write).
//
// Runs against the REAL worker + per-document DOs (SELF.fetch), with the fixture
// voice AI (no `AI` binding) — so a resolved proposal proves the figure was in
// the grounding context, and an unresolved one proves it was filtered out.
import { env, SELF } from "cloudflare:test";
import { zVoiceNoteProposal } from "@weavesteps/contract";
import type { DanceId } from "@weavesteps/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "./test-support/authed-context";
import { generateTestKeypair, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

const docs = env.DOC_DO;

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

const USER = "u_ctx";

/** Seed one figure DO (account-scoped) with a single-beat timeline. */
async function seedFigure(ref: string, figureType: string, name: string, dance: DanceId) {
  await docs.get(docs.idFromName(ref)).seedDoc({
    id: ref,
    scope: "account",
    ownerId: USER,
    figureType,
    dance,
    name,
    source: "custom",
    attributes: [
      { id: `${ref}_a1`, kind: "footwork", count: 1, role: null, value: "T", deletedAt: null },
    ],
    schemaVersion: 1,
    deletedAt: null,
  });
}

/** Seed one routine DO placing a single figure. */
async function seedRoutine(rt: string, dance: DanceId, title: string, figureRef: string) {
  await docs.get(docs.idFromName(rt)).seedDoc({
    id: rt,
    title,
    dance,
    ownerId: USER,
    sections: [
      { id: `${rt}_s1`, name: "A", placements: [{ id: `${rt}_p1`, figureRef, deletedAt: null }] },
    ],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  });
}

/**
 * A Foxtrot routine placing a Feather + a Waltz routine placing a Whisk, both
 * owned (editable) by USER, plus a mint of USER's auth. Returns the JWT headers.
 */
async function seedFoxtrotAndWaltz(): Promise<{
  headers: Record<string, string>;
  RT_FOX: string;
  RT_WALTZ: string;
}> {
  const FEATHER = `fig_ctx_feather_${crypto.randomUUID()}`;
  const WHISK = `fig_ctx_whisk_${crypto.randomUUID()}`;
  const RT_FOX = `rt_ctx_fox_${crypto.randomUUID()}`;
  const RT_WALTZ = `rt_ctx_waltz_${crypto.randomUUID()}`;

  await seedFigure(FEATHER, "feather", "Feather Step", "foxtrot");
  await seedFigure(WHISK, "whisk", "Whisk", "waltz");
  await seedRoutine(RT_FOX, "foxtrot", "Comp Slowfox", FEATHER);
  await seedRoutine(RT_WALTZ, "waltz", "Gold Waltz", WHISK);

  const ctx = await authedContext({ keypair: kp, userId: USER, docRef: RT_FOX, role: "editor" });
  await seedDb({
    users: [{ id: USER, displayName: "Dani", identityColor: "#111", plan: "free" }],
    docs: [
      { docRef: RT_FOX, type: "routine", ownerId: USER, doName: RT_FOX, dance: "foxtrot" },
      { docRef: RT_WALTZ, type: "routine", ownerId: USER, doName: RT_WALTZ, dance: "waltz" },
      { docRef: FEATHER, type: "account-figure", ownerId: USER, doName: FEATHER, dance: "foxtrot" },
      { docRef: WHISK, type: "account-figure", ownerId: USER, doName: WHISK, dance: "waltz" },
    ],
    memberships: [
      { id: `m_${RT_FOX}`, docRef: RT_FOX, userId: USER, role: "editor" },
      { id: `m_${RT_WALTZ}`, docRef: RT_WALTZ, userId: USER, role: "editor" },
      // Per-figure access edges (the snapshot/interpret gate resolves each ref).
      { id: `m_${FEATHER}`, docRef: FEATHER, userId: USER, role: "editor" },
      { id: `m_${WHISK}`, docRef: WHISK, userId: USER, role: "editor" },
    ],
  });
  return { headers: ctx.authHeaders(), RT_FOX, RT_WALTZ };
}

async function interpret(
  headers: Record<string, string>,
  body: { transcript: string; dance?: string; routineRef?: string },
) {
  const res = await SELF.fetch("https://x/api/voice-notes/interpret", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  // Re-validate the wire with the contract schema (same as the store seam does)
  // so the assertions read a typed proposal, never a cast.
  return zVoiceNoteProposal.parse(await res.json());
}

/** The proposed anchor's figureType, or undefined when it isn't a figureType anchor. */
function proposedFigureType(p: Awaited<ReturnType<typeof interpret>>): string | undefined {
  const anchor = p.proposed?.anchor;
  return anchor?.type === "figureType" ? anchor.figureType : undefined;
}

describe("interpret — dance-scoped grounding (context-first capture)", () => {
  it("scopes grounding to the named dance: a Foxtrot Feather resolves under foxtrot, not under waltz", async () => {
    const { headers } = await seedFoxtrotAndWaltz();
    const transcript = "In Feather Steps, settle the sway.";

    // dance=foxtrot → the Feather is in context → resolves to its family.
    const fox = await interpret(headers, { transcript, dance: "foxtrot" });
    expect(fox.resolved).toBe(true);
    expect(fox.proposed?.anchor.type).toBe("figureType");
    expect(proposedFigureType(fox)).toBe("feather");

    // dance=waltz → the Foxtrot Feather is FILTERED OUT of context → no match.
    const waltz = await interpret(headers, { transcript, dance: "waltz" });
    expect(waltz.resolved).toBe(false);
    expect(waltz.proposed).toBeNull();
  });

  it("no dance → the broad behavior: the Feather resolves from all annotate-capable choreos", async () => {
    const { headers } = await seedFoxtrotAndWaltz();
    const broad = await interpret(headers, { transcript: "In Feather Steps, settle the sway." });
    expect(broad.resolved).toBe(true);
    expect(proposedFigureType(broad)).toBe("feather");
  });

  it("a viewer-only routine of the scoped dance is excluded (per-figure authorization holds)", async () => {
    // A SECOND user shares a TANGO routine (a dance USER owns no choreo in) to
    // USER as VIEWER only — its figure must never enter USER's grounding context.
    // Scoping to `tango` isolates the assertion to just this viewer-only routine.
    const OTHER = "u_ctx_other";
    const PROM_V = `fig_ctx_vprom_${crypto.randomUUID()}`;
    const RT_V = `rt_ctx_vtango_${crypto.randomUUID()}`;
    await docs.get(docs.idFromName(PROM_V)).seedDoc({
      id: PROM_V,
      scope: "account",
      ownerId: OTHER,
      figureType: "promenade",
      dance: "tango",
      name: "Promenade",
      source: "custom",
      attributes: [
        { id: "vf_a1", kind: "footwork", count: 1, role: null, value: "T", deletedAt: null },
      ],
      schemaVersion: 1,
      deletedAt: null,
    });
    await docs.get(docs.idFromName(RT_V)).seedDoc({
      id: RT_V,
      title: "Other Tango",
      dance: "tango",
      ownerId: OTHER,
      sections: [
        { id: "vs1", name: "A", placements: [{ id: "vp1", figureRef: PROM_V, deletedAt: null }] },
      ],
      annotations: [],
      schemaVersion: 1,
      deletedAt: null,
    });
    const ctx = await authedContext({ keypair: kp, userId: USER, docRef: RT_V, role: "viewer" });
    await seedDb({
      users: [
        { id: USER, displayName: "Dani", identityColor: "#111", plan: "free" },
        { id: OTHER, displayName: "Other", identityColor: "#222", plan: "free" },
      ],
      docs: [
        { docRef: RT_V, type: "routine", ownerId: OTHER, doName: RT_V, dance: "tango" },
        { docRef: PROM_V, type: "account-figure", ownerId: OTHER, doName: PROM_V, dance: "tango" },
      ],
      memberships: [
        // USER can only VIEW the shared routine (not annotate) → excluded.
        { id: `m_${RT_V}_${USER}`, docRef: RT_V, userId: USER, role: "viewer" },
        { id: `m_${RT_V}_${OTHER}`, docRef: RT_V, userId: OTHER, role: "editor" },
        { id: `m_${PROM_V}_${OTHER}`, docRef: PROM_V, userId: OTHER, role: "editor" },
      ],
    });

    // dance=tango but USER only VIEWS the sole Tango routine → nothing to ground
    // against → unresolved (not a leak of the viewer-only figure).
    const res = await interpret(ctx.authHeaders(), {
      transcript: "In the Promenade, keep the head strong.",
      dance: "tango",
    });
    expect(res.resolved).toBe(false);
    expect(res.proposed).toBeNull();
  });
});
