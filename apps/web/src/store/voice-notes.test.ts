// AI voice notes — the store seam (docs/concepts/annotations.md § The Journal).
// The seam re-validates every response with the contract schema, so a component
// receives a schema-valid proposal or a thrown error — never a half-trusted body.
import { afterEach, describe, expect, it, vi } from "vitest";
import { interpretVoiceNote, transcribeVoiceClip } from "./voice-notes";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("interpretVoiceNote", () => {
  it("POSTs the transcript and returns a validated proposal", async () => {
    const proposal = {
      resolved: true,
      noteText: "settle the sway",
      confidence: "high",
      proposed: {
        anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
        routineRef: null,
        label: "all Feathers · all Foxtrot",
      },
      alternatives: [],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(proposal), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const got = await interpretVoiceNote(
      { transcript: "in slowfox settle the sway" },
      "tok",
      "http://test",
    );
    expect(got.resolved).toBe(true);
    expect(got.proposed?.label).toBe("all Feathers · all Foxtrot");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test/api/voice-notes/interpret",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
  });

  it("throws on a malformed proposal instead of returning it (never trust the wire)", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ resolved: "yes" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      interpretVoiceNote({ transcript: "x" }, null, "http://test"),
    ).rejects.toBeDefined();
  });
});

describe("transcribeVoiceClip", () => {
  it("uploads the clip and returns the transcript", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ transcript: "hello" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const clip = new Blob([new Uint8Array([1, 2, 3])]);
    const got = await transcribeVoiceClip(clip, "tok", "http://test");
    expect(got).toBe("hello");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test/api/voice-notes/transcribe",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws on a non-2xx transcribe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 413 })),
    );
    await expect(transcribeVoiceClip(new Blob([]), null, "http://test")).rejects.toBeDefined();
  });
});
