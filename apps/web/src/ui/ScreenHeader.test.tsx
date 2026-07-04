import { describe, expect, it, vi } from "vitest";
import { axeCheck, renderUi, screen, userEvent } from "../test-support/render";
import { IconButton } from "./IconButton";
import { ScreenHeader } from "./ScreenHeader";

describe("ScreenHeader", () => {
  it("renders the title and subtitle", () => {
    renderUi(<ScreenHeader title="Gold Waltz" subtitle="reading" />);
    expect(screen.getByText("Gold Waltz")).toBeInTheDocument();
    expect(screen.getByText("reading")).toBeInTheDocument();
  });

  it("exposes the title as a heading", () => {
    renderUi(<ScreenHeader title="Gold Waltz" />);
    expect(screen.getByRole("heading", { name: "Gold Waltz" })).toBeInTheDocument();
  });

  it("renders a back button with the default aria-label when onBack is given", async () => {
    const onBack = vi.fn();
    renderUi(<ScreenHeader title="Gold Waltz" onBack={onBack} />);
    const back = screen.getByRole("button", { name: "Back" });
    await userEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("honors a custom backLabel", () => {
    renderUi(<ScreenHeader title="Gold Waltz" onBack={() => {}} backLabel="Back to list" />);
    expect(screen.getByRole("button", { name: "Back to list" })).toBeInTheDocument();
  });

  it("omits the back button when onBack is not provided", () => {
    renderUi(<ScreenHeader title="Gold Waltz" />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("renders trailing actions", () => {
    renderUi(<ScreenHeader title="Gold Waltz" actions={<IconButton label="Edit">e</IconButton>} />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = renderUi(
      <ScreenHeader
        title="Gold Waltz"
        subtitle="reading"
        onBack={() => {}}
        actions={<IconButton label="Edit">e</IconButton>}
      />,
    );
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
