import { defineConfig, devices } from "@playwright/test";

// E2E layer (PLAN.md §10.3). Three device projects: desktop Chromium, mobile
// Chrome, mobile Safari (WebKit) — the cross-browser + mobile-first matrix.
// No sleeps: rely on Playwright's auto-waiting + web-first assertions.
// `retries: 1` + trace-on-first-retry per the plan.
//
// CI runs the SMOKE subset on PRs (grep @smoke); the full matrix runs
// nightly / on merge (see .github/workflows/ci.yml + nightly.yml).
const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
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
  // Serve the built SPA for E2E. `vite preview` mirrors production assets
  // (incl. the PWA service worker) better than the dev server.
  webServer: {
    command: `pnpm run preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
