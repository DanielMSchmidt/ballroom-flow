import { describe, expect, it, vi } from "vitest";
import { axeCheck, renderUi, screen, userEvent } from "../test-support/render";
import { SegmentedToggle } from "./SegmentedToggle";

type Role = "leader" | "follower";
const OPTIONS: { value: Role; label: string }[] = [
  { value: "leader", label: "Leader" },
  { value: "follower", label: "Follower" },
];

describe("SegmentedToggle", () => {
  it("renders every option label", () => {
    renderUi(
      <SegmentedToggle
        ariaLabel="Steps for"
        options={OPTIONS}
        value="leader"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Leader")).toBeInTheDocument();
    expect(screen.getByText("Follower")).toBeInTheDocument();
  });

  it("groups the segments under the accessible label", () => {
    renderUi(
      <SegmentedToggle
        ariaLabel="Steps for"
        options={OPTIONS}
        value="leader"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Steps for" })).toBeInTheDocument();
  });

  it("marks the selected segment with aria-checked", () => {
    renderUi(
      <SegmentedToggle
        ariaLabel="Steps for"
        options={OPTIONS}
        value="leader"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Leader" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Follower" })).not.toBeChecked();
  });

  it("calls onChange when a segment is clicked", async () => {
    const onChange = vi.fn();
    renderUi(
      <SegmentedToggle
        ariaLabel="Steps for"
        options={OPTIONS}
        value="leader"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Follower" }));
    expect(onChange).toHaveBeenCalledWith("follower");
  });

  it("moves selection and focus with ArrowRight (roving focus)", async () => {
    const onChange = vi.fn();
    renderUi(
      <SegmentedToggle
        ariaLabel="Steps for"
        options={OPTIONS}
        value="leader"
        onChange={onChange}
      />,
    );
    screen.getByRole("radio", { name: "Leader" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("follower");
    expect(screen.getByRole("radio", { name: "Follower" })).toHaveFocus();
  });

  it("moves selection and focus with ArrowLeft (roving focus)", async () => {
    const onChange = vi.fn();
    renderUi(
      <SegmentedToggle
        ariaLabel="Steps for"
        options={OPTIONS}
        value="follower"
        onChange={onChange}
      />,
    );
    screen.getByRole("radio", { name: "Follower" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenCalledWith("leader");
    expect(screen.getByRole("radio", { name: "Leader" })).toHaveFocus();
  });

  it("only the selected segment is in the tab order", () => {
    renderUi(
      <SegmentedToggle
        ariaLabel="Steps for"
        options={OPTIONS}
        value="leader"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Leader" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Follower" })).toHaveAttribute("tabindex", "-1");
  });

  it("has no axe violations", async () => {
    const { container } = renderUi(
      <SegmentedToggle
        ariaLabel="Steps for"
        options={OPTIONS}
        value="leader"
        onChange={() => {}}
      />,
    );
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
