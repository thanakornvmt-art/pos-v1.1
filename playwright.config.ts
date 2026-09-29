import { defineConfig } from "@playwright/test";
import { assertTestTarget } from "./tests/assert-test-target";
assertTestTarget();
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: process.env.TEST_BASE_URL ?? "http://127.0.0.1:3001",
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ??
        (process.platform === "win32"
          ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
          : undefined),
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
