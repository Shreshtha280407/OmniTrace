import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end coverage runs against the app in demo mode.
 *
 * Demo mode is the only configuration where the full flow is exercisable
 * without a live Atlas cluster and four provider keys — and because the demo
 * adapter is held to the same schemas as the live client, a flow that passes
 * here is a flow the real client can drive.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "line" : [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: "npm run build && npm run start -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      NEXT_PUBLIC_DEMO_MODE: "true",
      NEXT_PUBLIC_COLLECTION_ID: "demo_architecture",
    },
  },
});
