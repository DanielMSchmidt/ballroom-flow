import { describe, expect, it } from "vitest";
import {
  ATTR_COLUMNS,
  abbrevValue,
  COLUMN_KINDS,
  humanizeDirection,
  stepAction,
  stepFoot,
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
    expect(abbrevValue("footwork", "heel")).toBe("H");
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
    expect(humanizeDirection("diag_forward")).toBe("diag fwd");
    expect(humanizeDirection("side")).toBe("side");
  });

  it("alternates feet from the right for the leader, mirrored for the follower", () => {
    expect(stepFoot(0, "leader")).toBe("RF");
    expect(stepFoot(1, "leader")).toBe("LF");
    expect(stepFoot(0, "follower")).toBe("LF");
    expect(stepFoot(1, "follower")).toBe("RF");
  });

  it("builds a foot + direction headline, foot-only when no direction", () => {
    expect(stepAction(0, "leader", "forward")).toBe("RF forward");
    expect(stepAction(1, "leader", "side")).toBe("LF side");
    expect(stepAction(2, "leader", undefined)).toBe("RF");
  });
});
