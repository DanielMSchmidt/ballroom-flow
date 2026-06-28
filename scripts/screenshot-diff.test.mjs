import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { classify, renderComment } from "./screenshot-diff.mjs";

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

describe("renderComment", () => {
  const ctx = {
    owner: "o",
    repo: "r",
    baseSha: "BASE",
    headSha: "HEAD",
    basePath: "apps/web/src/marketing/screenshots",
  };
  it("shows a before/after table for changed rows and a marker", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "changed" }], ctx);
    expect(md).toContain("<!-- screenshot-bot -->");
    expect(md).toContain(
      "raw.githubusercontent.com/o/r/BASE/apps/web/src/marketing/screenshots/hero.png",
    );
    expect(md).toContain(
      "raw.githubusercontent.com/o/r/HEAD/apps/web/src/marketing/screenshots/hero.png",
    );
  });
  it("reports no changes when all unchanged", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "unchanged" }], ctx);
    expect(md).toContain("No screenshot changes");
  });
});
