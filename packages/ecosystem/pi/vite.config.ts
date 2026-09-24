import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      clean: false,
      dts: { sourcemap: true },
      entry: [
        "src/cli.ts",
        "src/config.ts",
        "src/extension.ts",
        "src/index.ts",
        "src/jsonl-tail.ts",
        "src/live-events.ts",
        "src/notification.ts",
        "src/plugin.ts",
        "src/projection.ts",
        "src/protocol.ts",
        "src/server.ts",
      ],
      deps: {
        neverBundle: [
          "jsonc-parser",
          "@earendil-works/pi-coding-agent",
          "@earendil-works/pi-tui",
        ],
      },
      format: "esm",
      outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
      splitting: true,
    },
    {
      entry: { react: "src/react.tsx" },
      clean: false,
      dts: { sourcemap: true },
      deps: {
        neverBundle: ["react", "react-dom", "react-markdown", "./styles.css"],
      },
      format: "esm",
      outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
      platform: "browser",
      splitting: true,
    },
  ],
});
