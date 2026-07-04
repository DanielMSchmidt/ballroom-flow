import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { classify, parseManifestEntries, renderComment } from "./screenshot-diff.mjs";

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
