// US-045 — GET /api/templates lists the app-owned sample routine.
// POST /api/routines/:id/fork on an app-owned template also covered here.
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import type { DocNamespace } from "../test-support/doc-do-api";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

const docs = env.DOC_DO as unknown as DocNamespace;
let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe("US-045 templates", () => {
  it("rejects an unauthenticated GET /api/templates with 401", async () => {
    const res = await SELF.fetch("https://x/api/templates");
    expect(res.status).toBe(401);
  });

  it("lists the app-owned Golden Waltz Basic template", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_tpl1", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_tpl1", displayName: "U1", identityColor: "#111", plan: "free" }],
    });
    const res = await SELF.fetch("https://x/api/templates", { headers: ctx.authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json<{ templates: Array<{ title: string; dance: string }> }>();
    expect(body.templates.length).toBeGreaterThan(0);
    // Task 6: template is Golden Waltz Basic, not Sample Foxtrot
    expect(body.templates.at(0) as { title: string; dance: string }).toMatchObject({
      title: "Golden Waltz Basic",
      dance: "waltz",
    });
  });

  it("allows forking the app-owned template into an owned routine", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_tpl2", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_tpl2", displayName: "U2", identityColor: "#222", plan: "free" }],
    });

    // Fetch the template list to get the templateRef
    const listRes = await SELF.fetch("https://x/api/templates", { headers: ctx.authHeaders() });
    expect(listRes.status).toBe(200);
    const { templates } = await listRes.json<{
      templates: Array<{ docRef: string; title: string }>;
    }>();
    expect(templates.length).toBeGreaterThan(0);
    const templateRef = (templates[0] as { docRef: string; title: string }).docRef;

    // Fork it — even though u_tpl2 has no membership row on the app template
    const forkRes = await SELF.fetch(`https://x/api/routines/${templateRef}/fork`, {
      method: "POST",
      headers: ctx.authHeaders(),
    });
    expect(forkRes.status).toBe(201);
    const fork = await forkRes.json<{
      docRef: string;
      forkedFromRef: string;
      title: string;
      dance: string;
    }>();
    expect(fork.forkedFromRef).toBe(templateRef);
    expect(fork.docRef).not.toBe(templateRef);
    expect(fork.title).toBe("Golden Waltz Basic");
    expect(fork.dance).toBe("waltz");

    // The fork is owned by the caller
    const listRoutines = await SELF.fetch("https://x/api/routines", { headers: ctx.authHeaders() });
    const { routines } = await listRoutines.json<{
      routines: Array<{ docRef: string; role: string }>;
    }>();
    expect(routines).toContainEqual(
      expect.objectContaining({ docRef: fork.docRef, role: "owner" }),
    );

    // The fork's DO content has the same sections/placements as the template.
    // SectionSnapshot only types `name`; cast to access placements for this assertion.
    const forkSnap = await docs.get(docs.idFromName(fork.docRef)).getSnapshot();
    const section = forkSnap.sections?.[0] as { placements?: unknown[] } | undefined;
    expect(section?.placements?.length).toBe(6);
  }, 15_000);

  it("re-seeds the template after a D1 reset wipes it (self-healing ensureSample)", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u_tpl3", docRef: "n/a", role: null });
    await seedDb({
      users: [{ id: "u_tpl3", displayName: "U3", identityColor: "#333", plan: "free" }],
    });

    // First call seeds the app template.
    const first = await SELF.fetch("https://x/api/templates", { headers: ctx.authHeaders() });
    expect(first.status).toBe(200);
    const firstBody = await first.json<{ templates: unknown[] }>();
    expect(firstBody.templates.length).toBeGreaterThan(0);

    // Simulate /api/test/reset: wipe the app-owned template rows from D1 the way
    // resetDb does (DELETE FROM document_registry). A stale module boolean would
    // leave the next GET permanently empty; the self-healing guard re-seeds.
    await env.DB.prepare("DELETE FROM document_registry WHERE ownerId = 'app'").run();
    // Confirm the wipe (read D1 directly, NOT via the API — a GET would re-seed).
    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE ownerId = 'app' AND type = 'routine'",
    ).first<{ n: number }>();
    expect(remaining?.n).toBe(0);

    // Next GET must RE-SEED (self-healing), not short-circuit on a stale guard.
    const reSeeded = await SELF.fetch("https://x/api/templates", { headers: ctx.authHeaders() });
    expect(reSeeded.status).toBe(200);
    const body = await reSeeded.json<{ templates: Array<{ title: string; dance: string }> }>();
    expect(body.templates.length).toBeGreaterThan(0);
    expect(body.templates[0]).toMatchObject({ title: "Golden Waltz Basic", dance: "waltz" });
  });
});
