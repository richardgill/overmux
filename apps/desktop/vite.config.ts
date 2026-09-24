import viteReact from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/renderer",
    rollupOptions: {
      input: resolve(import.meta.dirname, "index.html"),
    },
  },
  plugins: [viteReact()],
  pack: [
    {
      deps: { neverBundle: ["zod"] },
      dts: { sourcemap: false },
      entry: ["src/config/index.ts"],
      format: "esm",
      outDir: "dist/config",
      outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
      platform: "neutral",
    },
    {
      entry: {
        "desktop-config": "src/main/desktop-config.ts",
        index: "src/main/index.ts",
      },
      deps: {
        onlyBundle: ["zod"],
        neverBundle: ["electron", "jiti"],
      },
      outDir: "dist/main",
      outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
    },
    {
      entry: { preload: "src/preload/index.ts" },
      deps: { neverBundle: ["electron"] },
      format: "cjs",
      outDir: "dist/main",
      outExtensions: () => ({ dts: ".d.cts", js: ".cjs" }),
    },
    {
      entry: { "remote-notifications": "src/preload/remote-notifications.ts" },
      deps: { neverBundle: ["electron"] },
      format: "cjs",
      outDir: "dist/main",
      outExtensions: () => ({ dts: ".d.cts", js: ".cjs" }),
    },
  ],
});
