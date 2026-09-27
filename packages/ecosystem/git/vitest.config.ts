import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      {
        test: {
          include: ["src/**/*.unit.test.ts"],
          name: "node",
        },
      },
    ],
  },
});
