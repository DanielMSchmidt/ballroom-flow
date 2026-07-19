import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXPLAINER } from "./explainer.manifest";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("explainer video manifest", () => {
  it("points at an mp4 + png poster with non-empty copy", () => {
    expect(EXPLAINER.file).toMatch(/^[a-z-]+\.mp4$/);
    expect(EXPLAINER.poster).toMatch(/^[a-z-]+\.png$/);
    expect(EXPLAINER.title.length).toBeGreaterThan(0);
    expect(EXPLAINER.caption.length).toBeGreaterThan(0);
    expect(EXPLAINER.durationSeconds).toBeGreaterThan(0);
  });

  // The committed assets are produced by `pnpm video:generate`. Guard against a
  // manifest that references files that were never rendered/committed.
  it("the referenced asset files exist on disk", () => {
    expect(existsSync(path.join(HERE, EXPLAINER.file)), `missing ${EXPLAINER.file}`).toBe(true);
    expect(existsSync(path.join(HERE, EXPLAINER.poster)), `missing ${EXPLAINER.poster}`).toBe(true);
  });
});
