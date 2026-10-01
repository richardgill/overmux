import { resolve } from "node:path";
import { defineConfig } from "vite";

import { bundledDependencyNotices } from "./scripts/bundled-dependency-notices";

// Ship a self-contained classic worker, independent of userland's Vite mode/build.
export default defineConfig({
  // PNGs reuse apps/www/public/favicon.svg: a 192px logo and a 96px white,
  // transparent ring for Android's monochrome status-bar mask.
  publicDir: "src/internal/client/push-assets",
  build: {
    emptyOutDir: false,
    outDir: "dist/push",
    sourcemap: true,
    lib: {
      entry: resolve("src/internal/client/push-service-worker.ts"),
      name: "overmuxPush",
      formats: ["iife"],
      fileName: () => "sw.js",
    },
  },
  plugins: [bundledDependencyNotices({ inlineInChunks: true })],
});
