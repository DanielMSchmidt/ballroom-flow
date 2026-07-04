// US-043 — REST helpers for account-wide custom attribute kinds.
import { describe, expect, it, vi } from "vitest";

// Import dynamically inside tests to avoid a top-level fetch mock requirement
// (pattern from other store tests: module-level import is fine here since
// these helpers don't import @weavesteps/domain symbols that might not exist yet).
import { listAccountKinds, saveAccountKind } from "./custom-kinds";

describe("US-043 store/custom-kinds REST helpers", () => {
  it("listAccountKinds GET /api/account/custom-kinds and returns body.kinds", async () => {
    const kinds = [
      {
        kind: "energy",
        label: "Energy",
        color: "#c0563f",
        cardinality: "single",
        valueType: "enum",
        values: ["low", "high"],
        builtin: false,
      },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ kinds }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await listAccountKinds("tok_abc");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/custom-kinds",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok_abc" }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("energy");
    vi.unstubAllGlobals();
  });

  it("saveAccountKind POSTs to /api/account/custom-kinds", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const kind = {
      kind: "energy",
      label: "Energy",
      color: "#c0563f",
      cardinality: "single" as const,
      valueType: "enum",
      values: ["low", "high"],
      builtin: false,
    };
    await saveAccountKind("tok_abc", kind);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/custom-kinds",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok_abc" }),
      }),
    );
    vi.unstubAllGlobals();
  });
});
