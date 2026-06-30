import { describe, expect, it } from "vitest";
import { axeCheck, renderUi, screen } from "../test-support/render";
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
    expect(rule as HTMLElement).toHaveStyle({ background: "var(--bf-hairline)" });
  });

  it("forwards a className", () => {
    const { container } = renderUi(<SectionDivider label="2nd Long Side" className="mt-4" />);
    expect(container.firstChild).toHaveClass("mt-4");
  });

  it("has no axe violations", async () => {
    const { container } = renderUi(<SectionDivider label="1st Long Side" />);
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
