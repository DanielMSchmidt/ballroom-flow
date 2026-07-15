import { describe, expect, it, vi } from "vitest";
import { axeCheck, renderUi, screen, userEvent } from "../test-support/render";
import { SectionDivider } from "./SectionDivider";

describe("SectionDivider", () => {
  it("renders the label text", () => {
    renderUi(<SectionDivider label="1st Long Side" />);
    expect(screen.getByText("1st Long Side")).toBeInTheDocument();
  });

  it("renders a hairline rule using the hairline token (no hard-coded hex)", () => {
    const { container } = renderUi(<SectionDivider label="1st Long Side" />);
    const rule = container.querySelector('[aria-hidden="true"]');
    expect(rule).not.toBeNull();
    expect(rule).toHaveStyle({ background: "var(--bf-hairline)" });
  });

  it("forwards a className", () => {
    const { container } = renderUi(<SectionDivider label="2nd Long Side" className="mt-4" />);
    expect(container.firstChild).toHaveClass("mt-4");
  });

  it("has no axe violations", async () => {
    const { container } = renderUi(<SectionDivider label="1st Long Side" />);
    expect(await axeCheck(container)).toHaveNoViolations();
  });

  // ── Collapse toggle (Builder v3 reading view: tap the divider → fold the
  // section). The toggle renders ONLY when an onToggle is provided — plain
  // callers (FigureLibrary) keep the static eyebrow row. ──
  describe("collapse toggle", () => {
    it("stays a plain non-interactive row without onToggle", () => {
      renderUi(<SectionDivider label="1st Long Side" />);
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("renders an expanded toggle (aria-expanded=true) that fires onToggle", async () => {
      const onToggle = vi.fn();
      renderUi(
        <SectionDivider
          label="1st Long Side"
          collapsed={false}
          onToggle={onToggle}
          toggleLabel="Collapse 1st Long Side"
        />,
      );
      const btn = screen.getByRole("button", { name: "Collapse 1st Long Side" });
      expect(btn).toHaveAttribute("aria-expanded", "true");
      await userEvent.click(btn);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("renders the collapsed state with aria-expanded=false and the meta count", () => {
      renderUi(
        <SectionDivider
          label="1st Long Side"
          collapsed
          onToggle={() => {}}
          toggleLabel="Expand 1st Long Side"
          meta="3 figs"
        />,
      );
      const btn = screen.getByRole("button", { name: "Expand 1st Long Side" });
      expect(btn).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("3 figs")).toBeInTheDocument();
    });

    it("has no axe violations as a toggle", async () => {
      const { container } = renderUi(
        <SectionDivider
          label="1st Long Side"
          collapsed
          onToggle={() => {}}
          toggleLabel="Expand 1st Long Side"
          meta="3 figs"
        />,
      );
      expect(await axeCheck(container)).toHaveNoViolations();
    });
  });
});
