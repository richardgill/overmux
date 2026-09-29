import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

export default defineConfig({
  expect: { timeout: 5_000 },
  testDir: "./e2e",
  timeout: 20_000,
  // Full Chromium's headless mode supports notification permissions; headless shell does not.
  use: { baseURL: "http://127.0.0.1:4210", channel: "chromium" },
  webServer: {
    command:
      "node packages/runtime/overmux/dist/bin.js serve --config fixtures/overmux.config.ts",
    cwd: repositoryRoot,
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4210/",
  },
});
