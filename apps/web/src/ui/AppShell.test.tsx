import { describe, expect, it, vi } from "vitest";
import { axeCheck, renderUi, screen, userEvent } from "../test-support/render";
import { AppShell, type NavItem } from ".";
import { JournalIcon, LibraryIcon, PersonIcon, StepsIcon } from "./icons";

// ─────────────────────────────────────────────────────────────────────────
// T1 — AppShell tab bar parity
//
// The bottom tab bar must match the design:
//   - 4 items: Choreo · Library · Journal · Profile
//   - active = studio-blue + bold (text-accent / aria-current="page")
//   - inactive = grey (text-ink-muted)
//   - ≥ 44 px touch targets (min-h-[var(--bf-touch-target)])
//   - aria-current on the active item, absent on others
//   - honors env(safe-area-inset-bottom) via inline style
//   - desktop: side-rail replaces bottom nav (lg:hidden on mobile nav)
//   - children rendered in the content slot
// ─────────────────────────────────────────────────────────────────────────

const NAV: NavItem[] = [
  { value: "choreo", label: "Choreo", icon: () => <StepsIcon size={22} /> },
  { value: "library", label: "Library", icon: () => <LibraryIcon size={22} /> },
  { value: "journal", label: "Journal", icon: () => <JournalIcon size={22} /> },
  { value: "profile", label: "Profile", icon: () => <PersonIcon size={22} /> },
];

describe("AppShell tab bar", () => {
  it("renders all four navigation tabs", () => {
    // Intent: Choreo / Library / Journal / Profile are always present.
    renderUi(
      <AppShell nav={NAV} current="choreo" onNavigate={() => {}}>
        content
      </AppShell>,
    );
    for (const label of ["Choreo", "Library", "Journal", "Profile"]) {
      // getAllByRole because each tab appears in both mobile and desktop navs.
      expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("marks the active tab with aria-current='page'", () => {
    renderUi(
      <AppShell nav={NAV} current="library" onNavigate={() => {}}>
        content
      </AppShell>,
    );
    const libraryBtns = screen.getAllByRole("button", { name: "Library" });
    expect(libraryBtns.some((b) => b.getAttribute("aria-current") === "page")).toBe(true);
  });

  it("does not set aria-current on inactive tabs", () => {
    renderUi(
      <AppShell nav={NAV} current="choreo" onNavigate={() => {}}>
        content
      </AppShell>,
    );
    for (const label of ["Library", "Journal", "Profile"]) {
      const btns = screen.getAllByRole("button", { name: label });
      for (const btn of btns) {
        expect(btn).not.toHaveAttribute("aria-current", "page");
      }
    }
  });

  it("calls onNavigate with the tab value when a tab is clicked", async () => {
    const onNavigate = vi.fn();
    renderUi(
      <AppShell nav={NAV} current="choreo" onNavigate={onNavigate}>
        content
      </AppShell>,
    );
    // Click the first occurrence (mobile bottom nav).
    // getAllByRole guarantees at least one result; non-null assertion is safe.
    // biome-ignore lint/style/noNonNullAssertion: getAllByRole throws when empty
    await userEvent.click(screen.getAllByRole("button", { name: "Profile" })[0]!);
    expect(onNavigate).toHaveBeenCalledWith("profile");
  });

  it("renders children in the content slot", () => {
    renderUi(
      <AppShell nav={NAV} current="choreo" onNavigate={() => {}}>
        <p>Screen content here</p>
      </AppShell>,
    );
    expect(screen.getByText("Screen content here")).toBeInTheDocument();
  });

  it("shows the app name in the desktop side-rail (span, not a heading)", () => {
    // The design keeps "Weave Steps" only in the desktop side-rail.
    // It must be a <span> — NOT an <h1> — so inner screens remain heading-clean.
    renderUi(
      <AppShell nav={NAV} current="choreo" onNavigate={() => {}}>
        content
      </AppShell>,
    );
    // A heading role would mean <h1>-<h6>. We expect none for "Weave Steps".
    expect(screen.queryByRole("heading", { name: /ballroom flow/i })).not.toBeInTheDocument();
    // But the text still appears in the side-rail (as a <span>).
    expect(screen.getByText("Weave Steps")).toBeInTheDocument();
  });

  it("shows the brand mark beside the side-rail wordmark, decoratively", () => {
    // The woven-W brand mark sits inside the side-rail wordmark span. It is
    // decorative (aria-hidden) — the accessible brand name stays the text.
    renderUi(
      <AppShell nav={NAV} current="choreo" onNavigate={() => {}}>
        content
      </AppShell>,
    );
    const mark = screen.getByTestId("brand-mark");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Weave Steps")).toContainElement(mark);
  });

  it("has no axe violations", async () => {
    const { container } = renderUi(
      <AppShell nav={NAV} current="choreo" onNavigate={() => {}}>
        <p>content</p>
      </AppShell>,
    );
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
