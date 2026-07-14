import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { classify, parseManifestEntries, renderComment, renderDiff } from "./screenshot-diff.mjs";

function png(color) {
  const p = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = color[0];
    p.data[i + 1] = color[1];
    p.data[i + 2] = color[2];
    p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
}

describe("classify", () => {
  it("identical images are unchanged", () => {
    const a = png([10, 20, 30]);
    expect(classify(a, Buffer.from(a)).status).toBe("unchanged");
  });
  it("different images are changed", () => {
    expect(classify(png([0, 0, 0]), png([255, 255, 255])).status).toBe("changed");
  });
  it("missing base is new, missing head is removed", () => {
    expect(classify(null, png([0, 0, 0])).status).toBe("new");
    expect(classify(png([0, 0, 0]), null).status).toBe("removed");
  });
});

describe("parseManifestEntries", () => {
  it("pairs key+file correctly and ignores stray quoted key: literals between entries", () => {
    // This fixture deliberately includes a non-entry object with key: "decoy" but
    // no file: field. The OLD two-regex zip would produce keys=["decoy","hero","create"]
    // and files=["hero.png","create.png"], yielding wrong pairs:
    //   [{key:"decoy", file:"hero.png"}, {key:"hero", file:"create.png"}].
    // The new single-matchAll approach matches key+file as a pair per entry, so
    // "decoy" is never captured and both real entries keep their correct keys.
    const src = `
const DEFAULTS = { key: "decoy", label: "Fallback" };

export const SCREENSHOTS = [
  {
    key: "hero",
    file: "hero.png",
    alt: "Hero shot",
    caption: "Your whole routine.",
  },
  {
    key: "create",
    file: "create.png",
    alt: "Create screen",
    caption: "Start in seconds.",
  },
];
`;
    expect(parseManifestEntries(src)).toEqual([
      { key: "hero", file: "hero.png" },
      { key: "create", file: "create.png" },
    ]);
  });
});

describe("renderComment", () => {
  const ctx = {
    owner: "o",
    repo: "r",
    baseSha: "BASE",
    basePath: "apps/web/src/marketing/screenshots",
    artifactUrl: "https://gh/actions/runs/1",
  };
  it("inlines the committed BASE image, links the artifact, and keeps the marker", () => {
    const md = renderComment(
      [{ key: "hero", file: "hero.png", status: "changed", diffPixels: 1234 }],
      ctx,
    );
    expect(md).toContain("<!-- screenshot-bot -->");
    // "Before" is committed, so it inlines from the base SHA.
    expect(md).toContain(
      "raw.githubusercontent.com/o/r/BASE/apps/web/src/marketing/screenshots/hero.png",
    );
    // "After" is rendered but NOT committed — no head raw URL, and the artifact is linked.
    expect(md).not.toContain("/HEAD/");
    expect(md).toContain("https://gh/actions/runs/1");
    // Pixel delta is surfaced (formatted with a thousands separator).
    expect(md).toContain("1,234");
  });
  it("renders resized diffPixels (Infinity) as a label, not a number", () => {
    const md = renderComment(
      [{ key: "hero", file: "hero.png", status: "changed", diffPixels: Number.POSITIVE_INFINITY }],
      ctx,
    );
    expect(md).toContain("resized");
    expect(md).not.toContain("Infinity");
  });
  it("reports no changes when all unchanged", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "unchanged" }], ctx);
    expect(md).toContain("No screenshot changes");
  });
});

describe("renderDiff", () => {
  it("returns a PNG buffer for two same-size images that differ", () => {
    const out = renderDiff(png([0, 0, 0]), png([255, 255, 255]));
    expect(Buffer.isBuffer(out)).toBe(true);
    // A valid PNG buffer starts with the 8-byte PNG signature.
    expect(out.subarray(1, 4).toString("ascii")).toBe("PNG");
  });
  it("returns null when either side is missing", () => {
    expect(renderDiff(null, png([0, 0, 0]))).toBeNull();
    expect(renderDiff(png([0, 0, 0]), null)).toBeNull();
  });
});
