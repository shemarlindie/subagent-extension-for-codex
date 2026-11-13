import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  // Each test owns its service and data, so workers scale with the machine.
  // Half the cores measured fastest locally without slowing individual tests.
  // On CI that leaves the 3-core macOS runner one worker, so CI uses two.
  workers: process.env.CI ? 2 : "50%",
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    // Functional flows need stable controls. Motion suites opt into animations.
    reducedMotion: "reduce",
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
