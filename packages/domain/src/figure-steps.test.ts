import { describe, expect, it } from "vitest";
import { FIGURE_STEPS } from "./figure-steps";
import { LIBRARY_FIGURES } from "./library";
import { ATTRIBUTE_REGISTRY } from "./vocabulary";
import { parseWdsfTiming } from "./wdsf-timing";

describe("authored figure steps", () => {
  const directionValues = new Set(ATTRIBUTE_REGISTRY.direction.values ?? []);

  it("every authored figure exists in the library and its step count matches its timing", () => {
    // If the counts mismatch, buildWdsfAttributes silently falls back to the scaffold — so
    // this guard is what guarantees the verified content actually reaches the timeline.
    for (const key of Object.keys(FIGURE_STEPS)) {
      const [dance, figureType] = key.split(":");
      const fig = LIBRARY_FIGURES.find((f) => f.dance === dance && f.figureType === figureType);
      expect(fig, `${key} present in library`).toBeTruthy();
      expect(fig?.timing, `${key} has timing`).toBeTruthy();
      const counts = parseWdsfTiming(fig?.timing ?? "");
      expect(FIGURE_STEPS[key]?.length, `${key} step count == timing counts`).toBe(counts.length);
    }
  });

  it("uses valid direction values and non-empty footwork for both roles", () => {
    for (const [key, steps] of Object.entries(FIGURE_STEPS)) {
      for (const [i, step] of steps.entries()) {
        for (const role of ["leader", "follower"] as const) {
          expect(directionValues.has(step[role].direction), `${key} ${role}[${i}] direction`).toBe(
            true,
          );
          expect(step[role].footwork.length, `${key} ${role}[${i}] footwork`).toBeGreaterThan(0);
        }
      }
    }
  });
});
