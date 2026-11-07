import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  outputDir: process.env.PEPPER_E2E_OUTPUT || join(tmpdir(), "pepper-e2e-results"),
  use: {
    baseURL: process.env.PEPPER_E2E_ORIGIN,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      ...(process.env.PEPPER_E2E_BROWSER ? { executablePath: process.env.PEPPER_E2E_BROWSER } : {}),
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
