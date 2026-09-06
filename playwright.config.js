import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/web",
  testMatch: "*.spec.js",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    viewport: { width: 1440, height: 1080 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/web/server.js",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
});
