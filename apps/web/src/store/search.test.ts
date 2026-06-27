// US-046 — search REST helper.
import { describe, expect, it, vi } from "vitest";

import { search } from "./search";

describe("US-046 store/search REST helper", () => {
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
});
