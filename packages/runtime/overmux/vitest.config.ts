import { defineConfig } from "vitest/config";

import { baseConfig } from "../../../vitest.config";

const browserTests = [
  "src/internal/client/overmux-react.unit.test.tsx",
  "src/internal/client/shortcuts-browser.unit.test.tsx",
  "src/internal/client/theme-scope-browser.unit.test.tsx",
  "src/internal/client/host/update-popover.unit.test.tsx",
  "src/internal/client/host/hosted-pages/browser-notification-settings.unit.test.tsx",
  "src/internal/client/host/hosted-pages/logout-page.unit.test.tsx",
  "src/internal/client/host/overmux-host.unit.test.tsx",
  "src/internal/client/host/environment.unit.test.ts",
  "src/internal/client/host/deep-link-navigation.unit.test.ts",
  "src/internal/client/auth/auth-shell.unit.test.tsx",
  "src/internal/client/auth/entry.unit.test.tsx",
];

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    projects: [
      {
        test: {
          environment: "node",
          exclude: browserTests,
          include: [
            "scripts/**/*.unit.test.ts",
            "src/**/*.unit.test.{ts,tsx}",
            "src/**/*.e2e.test.{ts,tsx}",
          ],
          name: "node",
        },
      },
      {
        test: {
          environment: "happy-dom",
          include: browserTests,
          name: "react",
        },
      },
    ],
  },
});
