import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.E2E_PORT?.trim() || "3000";
if (!/^\d{1,5}$/.test(e2ePort) || Number(e2ePort) < 1 || Number(e2ePort) > 65_535) throw new Error("E2E_PORT_INVALID");
const e2eOrigin = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  globalTimeout: process.env.CI ? 25 * 60_000 : undefined,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: e2eOrigin,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${e2ePort}`,
    url: `${e2eOrigin}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      APP_ENV: "test",
      NODE_ENV: "development",
      APP_VERSION: "m3-008-e2e",
      APP_BASE_URL: e2eOrigin,
      ATTACHMENT_STORAGE_PROVIDER: "memory",
      ENABLE_TEST_MEMORY_ATTACHMENT_STORAGE: "true",
      ATTACHMENT_BUCKET: "local-private-attachments",
      ATTACHMENT_REGION: "local",
      ENABLE_FAKE_SYSTEM_PROVIDERS: "true",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
