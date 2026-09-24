import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      {
        test: {
          include: [
            "src/**/*.unit.test.ts",
            "src/react/diff-style.unit.test.tsx",
            "src/react/react.unit.test.tsx",
          ],
          name: "node",
        },
      },
      {
        test: {
          environment: "happy-dom",
          include: [
            "src/react/pierre-diff.unit.test.tsx",
            "src/react/pierre-tree.unit.test.tsx",
            "src/react/source-control-view.unit.test.tsx",
          ],
          name: "react",
        },
      },
    ],
  },
});
