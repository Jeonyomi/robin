import { defineConfig } from "@playwright/test";

const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    headless: true,
    trace: "on-first-retry",
    extraHTTPHeaders: vercelBypassSecret
      ? {
          "x-vercel-protection-bypass": vercelBypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        }
      : undefined,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
