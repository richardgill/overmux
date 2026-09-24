import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
          environment: "happy-dom",
          include: ["src/**/*.unit.test.tsx"],
          name: "react",
        },
      },
    ],
  },
});
