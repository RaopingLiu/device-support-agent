import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:8766",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `"${path.resolve("../.venv/Scripts/python.exe")}" "${path.resolve("../tests/workbench_server.py")}"`,
    url: "http://127.0.0.1:8766/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
