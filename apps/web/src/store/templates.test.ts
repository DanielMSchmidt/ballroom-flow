// US-045 — template list + template-fork REST helpers.
import { describe, expect, it, vi } from "vitest";

import { forkTemplate, listTemplates } from "./templates";

describe("US-045 store/templates REST helpers", () => {
  it("listTemplates GET /api/templates and returns body.templates", async () => {
    const templates = [
      {
        docRef: "t1",
        title: "Starter Waltz",
        dance: "waltz" as const,
        role: "viewer" as const,
        updatedAt: 1234567890,
      },
    ];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ templates }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listTemplates("tok_abc");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/templates",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok_abc" }),
      }),
    );
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]?.title).toBe("Starter Waltz");
    vi.unstubAllGlobals();
  });

  it("forkTemplate POSTs to /api/routines/:id/fork", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ docRef: "new-fork-ref" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await forkTemplate("tok_abc", "template-id");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/routines/template-id/fork",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok_abc" }),
      }),
    );
    expect(result.docRef).toBe("new-fork-ref");
    vi.unstubAllGlobals();
  });

  it("forkTemplate encodeURIComponent-encodes the docRef in the URL", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ docRef: "new-fork-ref" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await forkTemplate("tok_abc", "weird/id with space");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/routines/weird%2Fid%20with%20space/fork",
      expect.objectContaining({ method: "POST" }),
    );
    vi.unstubAllGlobals();
  });
});
