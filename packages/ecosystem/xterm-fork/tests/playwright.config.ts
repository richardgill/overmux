import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.test.ts",
  workers: 1,
  reporter: "list",
});
