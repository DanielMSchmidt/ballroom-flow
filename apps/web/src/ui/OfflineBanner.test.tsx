// US-050 AC-2 — the app-shell offline state: the SW-cached shell loads with no
// network and the UI says "you're offline" plainly (never silent stale data).
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axeCheck } from "../test-support/render";
import { OfflineBanner } from "./OfflineBanner";

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

afterEach(() => setOnLine(true));

describe("OfflineBanner (US-050)", () => {
  it("renders nothing while online", () => {
    setOnLine(true);
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });

  it("announces the offline state as a live status, and clears when back online", () => {
    setOnLine(false);
    render(<OfflineBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/offline/i);

    setOnLine(true);
    fireEvent(window, new Event("online"));
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });

  it("has no axe violations while offline", async () => {
    setOnLine(false);
    const { container } = render(<OfflineBanner />);
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
