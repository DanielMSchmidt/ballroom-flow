// US-045/US-046 — search + templates REST helpers.
import { describe, expect, it, vi } from "vitest";

import { forkTemplate, listTemplates, search } from "./search";

describe("US-046 store/search + US-045 store/templates REST helpers", () => {
  it("search GET /api/search?q=<encoded>&dance=<encoded> and returns body.results", async () => {
    const results = [
      {
        docRef: "r1",
        type: "routine" as const,
        title: "My Foxtrot",
        dance: "foxtrot" as const,
      },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await search("tok_abc", "My Foxtrot", "foxtrot");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/search?q=My%20Foxtrot&dance=foxtrot",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok_abc" }),
      }),
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.title).toBe("My Foxtrot");
    vi.unstubAllGlobals();
  });

  it("search omits dance param when undefined", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await search("tok_abc", "test");

    expect(fetchMock).toHaveBeenCalledWith("/api/search?q=test", expect.anything());
    vi.unstubAllGlobals();
  });

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
});
