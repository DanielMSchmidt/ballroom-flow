import { describe, expect, it } from "vitest";
import { shouldShowLanding } from "./landing-visibility";

describe("shouldShowLanding", () => {
  it("shows the landing page when signed out on a normal route", () => {
    expect(shouldShowLanding(false, "home")).toBe(true);
    expect(shouldShowLanding(false, "routine")).toBe(true);
  });

  it("does NOT show it on an invite route (let invite redemption run)", () => {
    expect(shouldShowLanding(false, "invite")).toBe(false);
  });

  it("never shows it when signed in", () => {
    expect(shouldShowLanding(true, "home")).toBe(false);
    expect(shouldShowLanding(true, "invite")).toBe(false);
  });
});
