import { defineConfig, type ViteUserConfig } from "vitest/config";

const isAgent =
  process.env.PI_CODING_AGENT === "true" ||
  process.env.CLAUDECODE === "1" ||
  process.env.CLAUDE_CODE_CHILD_SESSION === "1";

export const baseConfig: ViteUserConfig = {
  test: {
    watch: !isAgent && !process.env.CI && Boolean(process.stdin.isTTY),
    include: ["**/*.unit.test.ts", "**/*.unit.test.tsx"],
    mockReset: true,
    coverage: {
      provider: "v8",
      include: ["**/src/**"],
      exclude: ["**/tooling/**"],
    },
  },
};

export default defineConfig(baseConfig);
