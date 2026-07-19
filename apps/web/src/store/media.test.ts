// docs/ideas/annotation-media-embeds.md — store/media REST helper tests (mock the
// global fetch like search.test.ts). mintMediaUpload POSTs the contract body with a
// bearer token and Zod-parses the response; uploadMedia PUTs the blob under its
// content type (single PUT for small blobs).
import type { MintMediaUpload } from "@weavesteps/contract";
import { describe, expect, it, vi } from "vitest";
import { mintMediaUpload, uploadMedia } from "./media";

describe("store/media — mintMediaUpload", () => {
  it("POSTs /api/docs/:docRef/media/upload-url with the contract body + bearer, Zod-parses the response", async () => {
    const response = {
      objectKey: "media/r1/a1/m1",
      uploadUrl: "/api/media/media/r1/a1/m1",
      maxBytes: 10 * 1024 * 1024,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req: MintMediaUpload = {
      annotationId: "a1",
      mediaId: "m1",
      type: "image",
      mimeType: "image/jpeg",
      sizeBytes: 1234,
    };
    const result = await mintMediaUpload("tok_abc", "r1", req);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/docs/r1/media/upload-url",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok_abc" }),
        body: JSON.stringify(req),
      }),
    );
    expect(result).toEqual(response);
    vi.unstubAllGlobals();
  });

  it("throws if the mint response is malformed (Zod parse)", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ objectKey: "" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      mintMediaUpload("tok", "r1", {
        annotationId: "a1",
        mediaId: "m1",
        type: "image",
        mimeType: "image/jpeg",
        sizeBytes: 1,
      }),
    ).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("store/media — uploadMedia", () => {
  it("PUTs a small blob with its content type in a single request", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    await uploadMedia("tok_abc", "/api/media/media/r1/a1/m1", blob, "image/jpeg");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/media/media/r1/a1/m1",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: "Bearer tok_abc",
          "content-type": "image/jpeg",
        }),
        body: blob,
      }),
    );
    vi.unstubAllGlobals();
  });
});
