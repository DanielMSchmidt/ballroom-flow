import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderUi, screen, userEvent } from "../test-support/render";
import { ExplainerVideo, WatchTour } from "./ExplainerVideo";
import { EXPLAINER } from "./video/explainer.manifest";

describe("ExplainerVideo", () => {
  it("renders a labelled video for the manifest asset", () => {
    const { container } = renderUi(<ExplainerVideo />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    // Accessible name comes from the localized title (aria-label).
    expect(video).toHaveAttribute("aria-label", expect.stringContaining("tour"));
  });

  it("has no axe violations", async () => {
    const { container } = renderUi(<ExplainerVideo />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("WatchTour", () => {
  it("toggles the video open and closed", async () => {
    const user = userEvent.setup();
    renderUi(<WatchTour />);
    const toggle = screen.getByRole("button", { name: /watch the .*tour/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: /hide the tour/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps the manifest as the source of the asset filename", () => {
    expect(EXPLAINER.file.endsWith(".mp4")).toBe(true);
  });
});
