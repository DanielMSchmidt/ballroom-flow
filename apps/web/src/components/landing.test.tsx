import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { SCREENSHOTS } from "../marketing/screenshots.manifest";
import { renderUi, screen } from "../test-support/render";

// Stub the auth seam: the real AccountControls renders Clerk components that
// need a ClerkProvider not present in jsdom.
vi.mock("../auth/app-auth", () => ({
  AccountControls: () => <button type="button">Sign in</button>,
}));

describe("Landing", () => {
  it("renders a hero headline and a sign-in CTA", async () => {
    const { Landing } = await import("./Landing");
    renderUi(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it("renders every manifest screenshot with its alt text", async () => {
    const { Landing } = await import("./Landing");
    renderUi(<Landing />);
    for (const s of SCREENSHOTS) {
      expect(screen.getByAltText(s.alt)).toBeInTheDocument();
    }
  });

  it("has no axe violations", async () => {
    const { Landing } = await import("./Landing");
    const { container } = renderUi(<Landing />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
