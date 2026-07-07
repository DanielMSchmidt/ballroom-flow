import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { classifyPoster, MARKER, renderComment } from "./video-diff.mjs";

/** A WxH PNG filled with `color`, optionally recolouring the first `dirty` px. */
function png(color, { w = 100, h = 100, dirty = 0 } = {}) {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) {
    const px = i / 4;
    const c = px < dirty ? [255 - color[0], 255 - color[1], 255 - color[2]] : color;
    p.data[i] = c[0];
    p.data[i + 1] = c[1];
    p.data[i + 2] = c[2];
    p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
}

describe("classifyPoster", () => {
  it("identical posters are unchanged", () => {
    const a = png([10, 20, 30]);
    expect(classifyPoster(a, Buffer.from(a)).changed).toBe(false);
  });

  it("a brand-new poster (no committed one) counts as new+changed", () => {
    const res = classifyPoster(null, png([0, 0, 0]));
    expect(res.status).toBe("new");
    expect(res.changed).toBe(true);
  });

  it("no fresh render → unchanged (nothing to compare)", () => {
    expect(classifyPoster(png([0, 0, 0]), null).changed).toBe(false);
  });

  it("sub-threshold jitter (1% of pixels) is NOT a change at the 2% default", () => {
    // 100 of 10000 px flipped = 1% < 2% default threshold.
    const res = classifyPoster(png([10, 20, 30]), png([10, 20, 30], { dirty: 100 }));
    expect(res.diffPixels).toBeGreaterThan(0);
    expect(res.changed).toBe(false);
  });

  it("a real UI change (10% of pixels) trips the threshold", () => {
    const res = classifyPoster(png([10, 20, 30]), png([10, 20, 30], { dirty: 1000 }));
    expect(res.changed).toBe(true);
    expect(res.ratio).toBeGreaterThan(0.02);
  });

  it("a differing size is always a change", () => {
    const res = classifyPoster(
      png([0, 0, 0], { w: 100, h: 100 }),
      png([0, 0, 0], { w: 80, h: 80 }),
    );
    expect(res.changed).toBe(true);
  });

  it("threshold is configurable", () => {
    const buf = png([10, 20, 30], { dirty: 100 }); // 1%
    expect(classifyPoster(png([10, 20, 30]), buf, 0.005).changed).toBe(true);
    expect(classifyPoster(png([10, 20, 30]), buf, 0.05).changed).toBe(false);
  });
});

describe("renderComment", () => {
  const base = { owner: "o", repo: "r", newSha: "NEW" };

  it("new-asset body links the poster to the video with the sticky marker", () => {
    const md = renderComment({ ...base, prevSha: null, ratio: 1, status: "new" });
    expect(md).toContain(MARKER);
    expect(md).toContain(
      "raw.githubusercontent.com/o/r/NEW/apps/web/src/marketing/video/explainer-poster.png",
    );
    expect(md).toContain("explainer.mp4");
  });

  it("changed body shows a before/after table with both shas and the percentage", () => {
    const md = renderComment({ ...base, prevSha: "OLD", ratio: 0.123, status: "changed" });
    expect(md).toContain("12.3%");
    expect(md).toContain("/OLD/apps/web/src/marketing/video/explainer-poster.png");
    expect(md).toContain("/NEW/apps/web/src/marketing/video/explainer-poster.png");
  });
});
