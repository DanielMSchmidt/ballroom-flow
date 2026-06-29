import { describe, expect, it } from "vitest";
import { axeCheck, renderUi, screen } from "../test-support/render";
import { AttrChip } from "./AttrChip";

describe("AttrChip", () => {
  it("renders the label", () => {
    renderUi(<AttrChip kind="direction" label="fwd·HT" />);
    expect(screen.getByText("fwd·HT")).toBeInTheDocument();
  });

  it("fills a step chip with the direction kind color (kindVar)", () => {
    renderUi(<AttrChip kind="direction" label="fwd·HT" />);
    expect(screen.getByText("fwd·HT")).toHaveStyle({ background: "var(--bf-kind-direction)" });
  });

  it("tints a kind chip by its kind", () => {
    renderUi(<AttrChip kind="rise" label="comm" />);
    expect(screen.getByText("comm")).toHaveStyle({ background: "var(--bf-kind-rise)" });
  });

  it("uses an explicit color for a user-defined kind not in the standard palette", () => {
    renderUi(<AttrChip kind="head" label="left" color="#0f8a8a" />);
    expect(screen.getByText("left")).toHaveStyle({ background: "#0f8a8a" });
  });

  it("lowers opacity when dimmed", () => {
    renderUi(<AttrChip kind="direction" label="side·T" dimmed />);
    const chip = screen.getByText("side·T");
    expect(chip).toHaveStyle({ opacity: "0.5" });
  });

  it("is not dimmed by default", () => {
    renderUi(<AttrChip kind="direction" label="side·T" />);
    expect(screen.getByText("side·T")).not.toHaveStyle({ opacity: "0.5" });
  });

  it("has no axe violations", async () => {
    const { container } = renderUi(
      <div>
        <AttrChip kind="direction" label="fwd·HT" />
        <AttrChip kind="rise" label="up" />
        <AttrChip kind="head" label="left" color="#0f8a8a" dimmed />
      </div>,
    );
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
