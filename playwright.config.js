import { defineConfig, devices } from "@playwright/test";

// A port of its own, so a `vite preview` left running elsewhere is never mistaken for
// the build under test.
const PORT = 4180;

export default defineConfig({
  testDir: "tests",
  // Exports at 600 DPI and AI enhancement are slow by nature.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // Each worker holds full-size 600 DPI page canvases, so keep parallelism modest.
  workers: process.env.CI ? 1 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/support/global-setup.js",
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // The full Chromium build in new headless mode gets a hardware WebGL context where
      // one exists. The default headless shell only has SwiftShader, which makes the
      // ESRGAN enhancement test crawl.
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },
  ],
  // Tests run against a fresh production build, as deployed.
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
