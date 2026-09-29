import { resolve } from "node:path";
import { defineConfig } from "vite";

import { bundledDependencyNotices } from "./scripts/bundled-dependency-notices";

// Ship a self-contained classic worker, independent of userland's Vite mode/build.
export default defineConfig({
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
