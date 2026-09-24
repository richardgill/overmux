import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      {
        test: {
          environment: "node",
          include: ["src/**/*.unit.test.ts", "src/react.unit.test.tsx"],
          name: "node",
        },
      },
      {
        test: {
          environment: "happy-dom",
          include: [
            "src/composer.unit.test.tsx",
            "src/conversation-metadata.unit.test.tsx",
            "src/tool-renderers.unit.test.tsx",
          ],
          name: "react",
        },
      },
    ],
  },
});
