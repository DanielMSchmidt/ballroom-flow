import { describe, expect, it } from "vitest";
import { SCREENSHOTS } from "./screenshots.manifest";

describe("screenshots manifest", () => {
  it("has the six expected keys in order", () => {
    expect(SCREENSHOTS.map((s) => s.key)).toEqual([
      "hero",
      "create",
      "sections",
      "notate",
      "lanes",
      "reading",
    ]);
  });

  it("every entry has a unique .png file and non-empty alt + caption", () => {
    const files = SCREENSHOTS.map((s) => s.file);
    expect(new Set(files).size).toBe(files.length);
    for (const s of SCREENSHOTS) {
      expect(s.file).toMatch(/^[a-z]+\.png$/);
      expect(s.alt.length).toBeGreaterThan(0);
      expect(s.caption.length).toBeGreaterThan(0);
    }
  });
});
