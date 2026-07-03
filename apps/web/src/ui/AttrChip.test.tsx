import { describe, expect, it } from "vitest";
import { axeCheck, renderUi, screen } from "../test-support/render";
import { AttrChip } from "./AttrChip";

describe("AttrChip", () => {
  it("renders the label", () => {
    renderUi(<AttrChip kind="direction" label="fwd·HT" />);
    expect(screen.getByText("fwd·HT")).toBeInTheDocument();
  });

  it("tints a step chip with the direction kind family (kindVar)", () => {
    renderUi(<AttrChip kind="direction" label="fwd·HT" />);
    // (borderColor is asserted with a hex in the custom-kind test below —
    // jsdom's cssstyle drops `border-color: var(...)` declarations.)
    expect(screen.getByText("fwd·HT")).toHaveStyle({
      background: "var(--bf-kind-direction-tint)",
      color: "var(--bf-kind-direction-ink)",
    });
  });

  it("tints a kind chip by its kind", () => {
    renderUi(<AttrChip kind="rise" label="comm" />);
    expect(screen.getByText("comm")).toHaveStyle({
      background: "var(--bf-kind-rise-tint)",
      color: "var(--bf-kind-rise-ink)",
    });
  });

  it("uses an explicit color for a user-defined kind not in the standard palette", () => {
    // A clearly synthetic, non-promotable kind id — so this stays valid even if
    // real kinds (e.g. Head) are later added to the standard palette.
    renderUi(<AttrChip kind="custom-x" label="left" color="#0f8a8a" />);
    expect(screen.getByText("left")).toHaveStyle({
      color: "#0f8a8a",
      borderColor: "#0f8a8a",
      background: "var(--bf-surface-sunken)",
    });
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

  it("separates a vulgar-fraction turn amount from its direction letter", () => {
    // Inconsolata's vulgar-fraction glyphs (⅛ ¼ ⅜ …) overflow their advance
    // width, so a directly-abutting L/R visually collides. The chip inserts a
    // deterministic 2px gap between the fraction and the letter — reading
    // order/content stays "⅛R" for assistive tech and copy/paste.
    const { container } = renderUi(<AttrChip kind="turn" label="⅛R" />);
    const chip = container.querySelector("span");
    expect(chip?.textContent).toBe("⅛R");
    const letter = container.querySelector("[data-turn-direction]");
    expect(letter).not.toBeNull();
    expect(letter).toHaveTextContent("R");
    expect(letter).toHaveClass("ml-[2px]");
  });

  it("leaves non-fraction labels as a single text node", () => {
    const { container } = renderUi(<AttrChip kind="direction" label="fwd·HT" />);
    expect(container.querySelector("[data-turn-direction]")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = renderUi(
      <div>
        <AttrChip kind="direction" label="fwd·HT" />
        <AttrChip kind="rise" label="up" />
        <AttrChip kind="custom-x" label="left" color="#0f8a8a" dimmed />
      </div>,
    );
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
