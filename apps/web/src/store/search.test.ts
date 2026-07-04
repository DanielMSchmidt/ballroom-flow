// US-046 — search REST helper.
import { zSearchResults } from "@weavesteps/contract";
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

  it("zSearchResults.parse accepts type='global-figure' (FIX 1 — lock out the throw path)", () => {
    // Intent: the contract schema must accept all three search-result types so the
    //   web client's zSearchResults.parse never throws on a figure result, which
    //   would be swallowed by .catch(() => ({results:[]})) and silently empty the list.
    // This locks out the regression where the route returned type="figure" (raw DB
    //   value) and Zod rejected it.
    const payload = {
      results: [
        { docRef: "fig1", type: "global-figure", title: "Feather", dance: "foxtrot" },
        { docRef: "fig2", type: "account-figure", title: "My Feather", dance: "waltz" },
        { docRef: "rt1", type: "routine", title: "My Routine", dance: null },
      ],
    };
    expect(() => zSearchResults.parse(payload)).not.toThrow();
    const parsed = zSearchResults.parse(payload);
    expect(parsed.results).toHaveLength(3);
  });
});
