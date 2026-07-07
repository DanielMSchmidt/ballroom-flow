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

  it("uses valid direction values and non-empty footwork for every charted role", () => {
    // A step may carry only ONE role (role-asymmetric charts — e.g. the Double
    // Reverse Spin's follower "&" step), but never neither.
    for (const [key, steps] of Object.entries(FIGURE_STEPS)) {
      for (const [i, step] of steps.entries()) {
        expect(step.leader || step.follower, `${key}[${i}] has at least one role`).toBeTruthy();
        for (const role of ["leader", "follower"] as const) {
          const f = step[role];
          if (!f) continue;
          expect(directionValues.has(f.direction), `${key} ${role}[${i}] direction`).toBe(true);
          expect(f.footwork.length, `${key} ${role}[${i}] footwork`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("uses valid vocabulary tokens for the optional sway/turn/bodyActions/rise/position", () => {
    // The richer per-step attributes must be real registry values (closed enums),
    // or buildWdsfAttributes would emit attributes the write schema (US-012) rejects.
    const swayValues = new Set(ATTRIBUTE_REGISTRY.sway.values ?? []);
    const turnValues = new Set(ATTRIBUTE_REGISTRY.turn.values ?? []);
    const baValues = new Set(ATTRIBUTE_REGISTRY.bodyActions.values ?? []);
    const riseValues = new Set(ATTRIBUTE_REGISTRY.rise.values ?? []);
    const positionValues = new Set(ATTRIBUTE_REGISTRY.position.values ?? []);
    for (const [key, steps] of Object.entries(FIGURE_STEPS)) {
      for (const [i, step] of steps.entries()) {
        if (step.rise) expect(riseValues.has(step.rise), `${key}[${i}] rise`).toBe(true);
        if (step.position)
          expect(positionValues.has(step.position), `${key}[${i}] position`).toBe(true);
        for (const role of ["leader", "follower"] as const) {
          const f = step[role];
          if (!f) continue;
          if (f.sway) expect(swayValues.has(f.sway), `${key} ${role}[${i}] sway`).toBe(true);
          if (f.turn) expect(turnValues.has(f.turn), `${key} ${role}[${i}] turn`).toBe(true);
          for (const ba of f.bodyActions ?? [])
            expect(baValues.has(ba), `${key} ${role}[${i}] bodyAction ${ba}`).toBe(true);
        }
      }
    }
  });
});
