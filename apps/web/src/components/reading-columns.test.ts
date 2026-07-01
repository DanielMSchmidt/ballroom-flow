import type { Attribute, RegistryKind } from "@ballroom/domain";
import { describe, expect, it } from "vitest";
import {
  allColumns,
  cellValue,
  isOffBeatCount,
  stepChipLabel,
  usedColumns,
} from "./reading-columns";

const attr = (
  count: number,
  kind: string,
  value: unknown,
  role: Attribute["role"] = null,
): Attribute => ({
  id: `${kind}-${count}-${String(value)}`,
  kind,
  count,
  value,
  role,
  deletedAt: null,
});

describe("stepChipLabel — merged direction + footwork", () => {
  it("merges direction and footwork into one 'fwd·B' chip", () => {
    expect(stepChipLabel("forward", "ball")).toBe("fwd·B");
    expect(stepChipLabel("side", "toe")).toBe("side·T");
    expect(stepChipLabel("close", "HT")).toBe("close·HT"); // compound ISTD token passes through
  });

  it("falls back to whichever side is present", () => {
    expect(stepChipLabel("forward", null)).toBe("fwd");
    expect(stepChipLabel(null, "ball")).toBe("B");
  });

  it("returns null when the step has neither (attribute on its own timing)", () => {
    expect(stepChipLabel(null, null)).toBeNull();
    expect(stepChipLabel("", "")).toBeNull();
  });
});

describe("usedColumns — only the kinds a figure actually uses", () => {
  it("leads with Step, then the standard technique kinds present, in order", () => {
    const attrs = [
      attr(1, "direction", "forward"),
      attr(1, "footwork", "heel"),
      attr(1, "rise", "commence"),
      attr(1, "position", "closed"),
      attr(1, "turn", "quarter_R"),
    ];
    expect(usedColumns(attrs).map((c) => c.label)).toEqual(["Step", "Rise", "Pos", "Turn"]);
  });

  it("omits a kind with no values (Natural Turn has no Sway)", () => {
    const attrs = [attr(1, "direction", "forward"), attr(1, "rise", "up"), attr(1, "turn", "none")];
    const labels = usedColumns(attrs).map((c) => c.label);
    expect(labels).toContain("Rise");
    expect(labels).not.toContain("Sway");
  });

  it("never gives direction/footwork their own column (they feed Step)", () => {
    const cols = usedColumns([attr(1, "direction", "forward"), attr(1, "footwork", "toe")]);
    expect(cols.map((c) => c.id)).toEqual(["step"]);
  });

  it("appends a custom kind as its own titled column after the standards", () => {
    const cols = usedColumns([attr(1, "direction", "forward"), attr(1, "head", "left")]);
    expect(cols.map((c) => c.label)).toEqual(["Step", "Head"]);
  });

  it("omits Step entirely when an attribute sits with no direction/footwork", () => {
    expect(usedColumns([attr(1.5, "position", "promenade")]).map((c) => c.label)).toEqual(["Pos"]);
  });

  it("excludes the Rise column for Tango (registry appliesToDances), even with a stray value", () => {
    // The write path does not strictly block a rise value on a Tango figure, so
    // the reading view defends against one by hiding the inapplicable column.
    const attrs = [attr(1, "direction", "forward"), attr(1, "rise", "up"), attr(1, "turn", "none")];
    expect(usedColumns(attrs, "tango").map((c) => c.label)).toEqual(["Step", "Turn"]);
    // The same figure in Waltz keeps Rise.
    expect(usedColumns(attrs, "waltz").map((c) => c.label)).toEqual(["Step", "Rise", "Turn"]);
  });
});

describe("cellValue", () => {
  const cols = usedColumns([
    attr(1, "direction", "forward"),
    attr(1, "footwork", "heel"),
    attr(1, "turn", "quarter_R"),
  ]);
  const stepCol = cols[0];
  const turnCol = cols.find((c) => c.id === "turn");

  it("renders the merged step chip for the Step column", () => {
    expect(stepCol).toBeDefined();
    expect(turnCol).toBeDefined();
    const here = [attr(1, "direction", "forward"), attr(1, "footwork", "heel")];
    if (stepCol) expect(cellValue(here, stepCol)).toBe("fwd·H");
  });

  it("renders the tight value code for a technique column, null when empty", () => {
    if (!turnCol) throw new Error("turn column expected");
    expect(cellValue([attr(1, "turn", "quarter_R")], turnCol)).toBe("¼R");
    expect(cellValue([], turnCol)).toBeNull();
  });
});

describe("allColumns — every applicable kind for the EDIT grid", () => {
  it("always leads with Step then every standard technique kind for a rise dance", () => {
    expect(allColumns("waltz").map((c) => c.label)).toEqual([
      "Step",
      "Rise",
      "Pos",
      "Feet",
      "Body",
      "Sway",
      "Turn",
    ]);
  });

  it("offers all-applicable columns even with no attributes placed (empty cells are addable)", () => {
    // Unlike usedColumns (only-used), the edit grid shows kinds with no value yet.
    expect(allColumns("foxtrot").map((c) => c.id)).toContain("rise");
    expect(allColumns("foxtrot").map((c) => c.id)).toContain("turn");
  });

  it("omits the Rise column for Tango (registry appliesToDances)", () => {
    const labels = allColumns("tango").map((c) => c.label);
    expect(labels).not.toContain("Rise");
    expect(labels).toContain("Turn");
  });

  it("appends an applicable custom kind as its own column after the standards", () => {
    const head: RegistryKind = {
      kind: "head",
      label: "Head",
      color: "#445566",
      cardinality: "single",
      valueType: "enum",
      values: ["left", "right"],
      builtin: false,
    };
    const cols = allColumns("waltz", [head]);
    expect(cols.at(-1)).toMatchObject({ id: "head", label: "Head" });
  });
});

describe("isOffBeatCount", () => {
  it("treats fractional counts as off-beat", () => {
    expect(isOffBeatCount(1)).toBe(false);
    expect(isOffBeatCount(2)).toBe(false);
    expect(isOffBeatCount(1.5)).toBe(true);
    expect(isOffBeatCount(3.75)).toBe(true);
  });
});
