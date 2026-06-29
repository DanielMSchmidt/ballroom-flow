import { describe, expect, it } from "vitest";
import { appGate, shouldShowLanding } from "./landing-visibility";

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

describe("appGate", () => {
  it("waits in 'loading' until auth resolves (no logged-out flash)", () => {
    // While Clerk is still loading, isSignedIn reads false — but we must NOT show
    // the Landing yet, or a signed-in user is flashed the marketing page.
    expect(appGate(false, false, "home")).toBe("loading");
    expect(appGate(false, true, "home")).toBe("loading");
    expect(appGate(false, false, "invite")).toBe("loading");
  });

  it("sends a signed-in user to the app (the choreo list), never the Landing", () => {
    expect(appGate(true, true, "home")).toBe("app");
    expect(appGate(true, true, "routine")).toBe("app");
  });

  it("shows the Landing to a signed-out user on a normal route", () => {
    expect(appGate(true, false, "home")).toBe("landing");
    expect(appGate(true, false, "routine")).toBe("landing");
  });

  it("lets an invite deep-link reach the app even when signed out", () => {
    expect(appGate(true, false, "invite")).toBe("app");
  });
});
