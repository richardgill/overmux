// Runs the xterm wrapper tests against a small DOM and fake xterm APIs.
// Browser integration remains a deliberate manual testing boundary.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.unit.test.ts", "src/**/*.unit.test.tsx"],
  },
});
