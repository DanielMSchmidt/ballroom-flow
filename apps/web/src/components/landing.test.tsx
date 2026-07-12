import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { SCREENSHOTS } from "../marketing/screenshots.manifest";
import { renderUi, screen } from "../test-support/render";

// Stub the auth seam: the real AccountControls renders Clerk components that
// need a ClerkProvider not present in jsdom. NullAuthProvider is included as a
// passthrough so renderUi's provider wrapper (which imports it) keeps working.
vi.mock("../auth/app-auth", () => ({
  AccountControls: () => <button type="button">Sign in</button>,
  NullAuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("Landing", () => {
  it("renders a hero headline and a sign-in CTA", async () => {
    const { Landing } = await import("./Landing");
    renderUi(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it("renders every landing manifest screenshot with its alt text (diff-only entries stay off)", async () => {
    const { Landing } = await import("./Landing");
    renderUi(<Landing />);
    for (const s of SCREENSHOTS) {
      if (s.diffOnly) {
        // Tracked by the CI visual diff only — never part of the marketing page.
        expect(screen.queryByAltText(s.alt)).toBeNull();
      } else {
        expect(screen.getByAltText(s.alt)).toBeInTheDocument();
      }
    }
  });

  it("shows the brand mark in the header, decoratively", async () => {
    const { Landing } = await import("./Landing");
    renderUi(<Landing />);
    const mark = screen.getByTestId("brand-mark");
    expect(mark).toHaveAttribute("aria-hidden", "true");
  });

  it("has no axe violations", async () => {
    const { Landing } = await import("./Landing");
    const { container } = renderUi(<Landing />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
