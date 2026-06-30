import { describe, expect, it } from "vitest";
import {
  ATTR_COLUMNS,
  abbrevValue,
  COLUMN_KINDS,
  humanizeDirection,
  stepAction,
} from "./attribute-display";

describe("attribute-display — columns", () => {
  it("exposes the five technique columns in design order with their codes/tones", () => {
    expect(ATTR_COLUMNS.map((c) => c.code)).toEqual(["Ri", "Bo", "Fw", "Sw", "Tn"]);
    expect(ATTR_COLUMNS.map((c) => c.tone)).toEqual([
      "rise",
      "position",
      "footwork",
      "sway",
      "turn",
    ]);
  });

  it("routes body actions into the Body column, but not direction", () => {
    expect(COLUMN_KINDS.has("direction")).toBe(false);
    expect(COLUMN_KINDS.has("bodyActions")).toBe(true);
    expect(COLUMN_KINDS.has("rise")).toBe(true);
    // The Body column carries position first, then body actions.
    expect(ATTR_COLUMNS.find((c) => c.code === "Bo")?.kinds).toEqual(["position", "bodyActions"]);
  });
});

describe("attribute-display — abbrevValue", () => {
  it("maps known enum values to tight codes", () => {
    expect(abbrevValue("rise", "commence")).toBe("com");
    expect(abbrevValue("turn", "quarter_R")).toBe("¼R");
    expect(abbrevValue("position", "closed")).toBe("Cl");
    expect(abbrevValue("position", "CBMP")).toBe("CBP"); // CBMP is now a position
    expect(abbrevValue("footwork", "heel")).toBe("H"); // legacy anatomical still maps
    // Canonical footwork picker codes render verbatim (no stale remapping).
    expect(abbrevValue("footwork", "HT")).toBe("HT");
    expect(abbrevValue("footwork", "heel pull")).toBe("HP");
  });

  it("joins a multi-set value", () => {
    expect(abbrevValue("bodyActions", ["CBM", "CBMP"])).toBe("CB,CBP");
  });

  it("falls back to a short prefix for custom/unknown values", () => {
    expect(abbrevValue("footwork", "heel_pull")).toBe("hee");
    expect(abbrevValue("custom", "spin")).toBe("spin");
  });
});

describe("attribute-display — step headline", () => {
  it("humanizes directions", () => {
    expect(humanizeDirection("diagonal")).toBe("diagonal");
    expect(humanizeDirection("behind")).toBe("behind");
    expect(humanizeDirection("side")).toBe("side");
    // A legacy split-diagonal value still renders sensibly.
    expect(humanizeDirection("diag_forward")).toBe("diagonal");
  });

  it("uses the direction as the headline, with an em dash when none is set", () => {
    expect(stepAction("forward")).toBe("forward");
    expect(stepAction("diagonal")).toBe("diagonal");
    expect(stepAction(undefined)).toBe("—");
    expect(stepAction("")).toBe("—");
  });
});
