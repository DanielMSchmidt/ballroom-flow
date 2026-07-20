// docs/ideas/annotation-media-embeds.md — unit tests for the PURE media-file
// decision helpers (jsdom has no real canvas/createImageBitmap, so we test the
// decisions the browser helpers make, not the browser APIs themselves).
import { describe, expect, it } from "vitest";
import { boundedDimensions, IMAGE_MAX_EDGE, youtubeVideoId } from "./media-files";

describe("youtubeVideoId", () => {
  it("accepts a youtu.be short link", () => {
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("accepts a watch URL with extra params", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")).toBe("dQw4w9WgXcQ");
  });

  it("accepts a youtube-nocookie embed URL", () => {
    expect(youtubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("returns null for garbage / non-YouTube URLs", () => {
    expect(youtubeVideoId("not a url")).toBeNull();
    expect(youtubeVideoId("https://vimeo.com/12345")).toBeNull();
    expect(youtubeVideoId("https://youtu.be/tooshort")).toBeNull();
    expect(youtubeVideoId("https://www.youtube.com/watch?v=")).toBeNull();
  });
});

describe("boundedDimensions", () => {
  it("leaves an already-small image untouched", () => {
    expect(boundedDimensions(800, 600, IMAGE_MAX_EDGE)).toEqual({ w: 800, h: 600 });
  });

  it("scales the longest edge down to the max, preserving aspect ratio", () => {
    const { w, h } = boundedDimensions(4000, 3000, 1600);
    expect(w).toBe(1600);
    expect(h).toBe(1200);
  });

  it("bounds a portrait image by its longest (vertical) edge", () => {
    const { w, h } = boundedDimensions(3000, 4000, 1600);
    expect(h).toBe(1600);
    expect(w).toBe(1200);
  });

  it("never upscales and tolerates zero", () => {
    expect(boundedDimensions(100, 100, 1600)).toEqual({ w: 100, h: 100 });
    expect(boundedDimensions(0, 0, 1600)).toEqual({ w: 0, h: 0 });
  });
});
