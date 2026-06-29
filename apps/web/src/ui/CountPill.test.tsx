import { describe, expect, it } from "vitest";
import { axeCheck, renderUi, screen } from "../test-support/render";
import { CountPill } from "./CountPill";

describe("CountPill", () => {
  it("renders every count token", () => {
    renderUi(<CountPill counts={["1", "2", "3"]} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders on-beat and off-beat tokens together", () => {
    renderUi(<CountPill counts={["1", "&", "2", "&", "3", "a"]} />);
    expect(screen.getAllByText("&")).toHaveLength(2);
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("dims off-beat tokens with the off-beat ink and keeps on-beat normal", () => {
    renderUi(<CountPill counts={["1", "&", "a", "e", "i"]} />);
    // On-beat numerals are not dimmed.
    expect(screen.getByText("1")).not.toHaveAttribute("data-offbeat");
    // Off-beat sub-beat tokens are flagged for dim styling.
    for (const tok of ["&", "a", "e", "i"]) {
      expect(screen.getByText(tok)).toHaveAttribute("data-offbeat", "true");
    }
  });

  it("uses the off-beat ink token for dimmed tokens (no hard-coded hex)", () => {
    renderUi(<CountPill counts={["&"]} />);
    expect(screen.getByText("&")).toHaveStyle({ color: "var(--bf-offbeat-ink)" });
  });

  it("has no axe violations", async () => {
    const { container } = renderUi(<CountPill counts={["1", "&", "2"]} />);
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
