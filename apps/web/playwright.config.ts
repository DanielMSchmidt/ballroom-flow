import { defineConfig, devices } from "@playwright/test";

// E2E layer (PLAN.md §10.3). Three device projects: desktop Chromium, mobile
// Chrome, mobile Safari (WebKit) — the cross-browser + mobile-first matrix.
// No sleeps: rely on Playwright's auto-waiting + web-first assertions.
// `retries: 1` + trace-on-first-retry per the plan.
//
// CI runs the SMOKE subset on PRs (grep @smoke); the full matrix runs
// nightly / on merge (see .github/workflows/ci.yml + nightly.yml).
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "./e2e",
  // Serialized: the journeys share ONE local D1 (the worker's e2e state), so they
  // reset+seed deterministically rather than racing across parallel workers (#191).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],
  // Serve the journeys against the REAL backend (#191): e2e/serve.sh builds the
  // E2E SPA, migrates a fresh local D1, and runs the worker (SPA + API + WS at
  // one origin) with the test CLERK_JWT_KEY. This is what makes the journeys
  // exercise the real auth/permission boundary instead of a static preview.
  webServer: {
    command: `E2E_PORT=${PORT} bash e2e/serve.sh`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
