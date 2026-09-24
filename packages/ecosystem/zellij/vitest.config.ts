import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      {
        test: {
          environment: "node",
          include: ["src/**/*.unit.test.ts"],
          name: "node",
        },
      },
      {
        test: {
          environment: "node",
          include: ["src/**/*.e2e.test.ts"],
          name: "integration",
          testTimeout: 60_000,
        },
      },
      {
        test: {
          environment: "happy-dom",
          include: ["src/**/*.unit.test.tsx"],
          name: "react",
        },
      },
    ],
  },
});
