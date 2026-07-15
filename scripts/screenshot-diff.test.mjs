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
    basePath: "apps/web/src/marketing/screenshots",
    artifactUrl: "https://gh/actions/runs/1",
  };
  // With release-asset env, "after" inlines from a stable download URL.
  const assetCtx = {
    ...ctx,
    assetUrlBase: "https://github.com/o/r/releases/download/ci-screenshots",
    assetPrefix: "pr-7-SHA-",
  };
  it("inlines the committed BASE image, links the artifact, and keeps the marker (no asset env)", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "changed" }], ctx);
    expect(md).toContain("<!-- screenshot-bot -->");
    // "Before" is committed, so it inlines from the base SHA.
    expect(md).toContain(
      "raw.githubusercontent.com/o/r/BASE/apps/web/src/marketing/screenshots/hero.png",
    );
    // Without release assets there is no after URL, and the artifact is linked.
    expect(md).not.toContain("/HEAD/");
    expect(md).not.toContain("releases/download");
    expect(md).toContain("https://gh/actions/runs/1");
  });
  it("inlines before and after from release-asset URLs when the env is set (no diff, no Δ)", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "changed" }], assetCtx);
    // "before" inlines the exact bytes that were diffed (staged as a release
    // asset) — NOT a raw.githubusercontent URL, which only exists for committed
    // images and diverges once the baseline comes from the main-run artifact.
    expect(md).toContain(
      "https://github.com/o/r/releases/download/ci-screenshots/pr-7-SHA-hero.before.png",
    );
    // "after" inlines from the prerelease's asset download URL; no diff image or Δ column.
    expect(md).toContain(
      "https://github.com/o/r/releases/download/ci-screenshots/pr-7-SHA-hero.after.png",
    );
    expect(md).not.toContain("raw.githubusercontent.com");
    expect(md).not.toContain(".diff.png");
    expect(md).not.toContain("Δ pixels");
  });
  it("names the main baseline run when the baseline came from the artifact", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "changed" }], {
      ...assetCtx,
      baselineSha: "abcdef0123456789abcdef0123456789abcdef01",
    });
    expect(md).toContain("abcdef0");
    expect(md).toContain("screenshots-baseline");
  });
  it("falls back to describing the committed baseline when no baseline sha is set", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "changed" }], assetCtx);
    expect(md).toContain("committed");
    expect(md).not.toContain("screenshots-baseline");
  });
  it("inlines the before release asset for a REMOVED screenshot", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "removed" }], assetCtx);
    expect(md).toContain("### Removed");
    expect(md).toContain(
      "https://github.com/o/r/releases/download/ci-screenshots/pr-7-SHA-hero.before.png",
    );
  });
  it("inlines the after image for a NEW screenshot (no before) under release assets", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "new" }], assetCtx);
    expect(md).toContain("### New");
    expect(md).toContain(
      "https://github.com/o/r/releases/download/ci-screenshots/pr-7-SHA-hero.after.png",
    );
    // A brand-new screenshot has no base, so no before/diff image.
    expect(md).not.toContain("raw.githubusercontent.com");
    expect(md).not.toContain(".diff.png");
  });
  it("reports no changes when all unchanged", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "unchanged" }], assetCtx);
    expect(md).toContain("No screenshot changes");
  });
});
