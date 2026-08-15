import { defineConfig, devices } from "@playwright/test";

/**
 * Default navigation waitUntil is "domcontentloaded" (see tests/helpers/fixtures.ts).
 * Playwright has no config-level waitUntil; Appwrite Realtime must not use networkidle.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e/**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        browserName: "chromium",
      },
    },
  ],
});
