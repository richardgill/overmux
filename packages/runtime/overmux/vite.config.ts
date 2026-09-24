import { defineConfig } from "vite-plus";

import { bundledDependencyNotices } from "./scripts/bundled-dependency-notices";

export default defineConfig({
  plugins: [bundledDependencyNotices()],
  build: {
    emptyOutDir: true,
    sourcemap: true,
    outDir: "dist",
    rollupOptions: {
      external: [
        /^(?:@hono\/node-server|es-module-lexer|hono|httpxy|jiti|typescript|vite|web-push|ws|zod)(?:\/|$)/,
      ],
      output: {
        banner: "#!/usr/bin/env node",
        entryFileNames: "bin.js",
      },
    },
    ssr: "src/internal/cli/bin.ts",
    target: "node24",
  },
  ssr: {
    noExternal: true,
  },
  pack: [
    {
      clean: false,
      deps: { neverBundle: ["./styles.css"] },
      dts: { sourcemap: true },
      entry: ["src/public/index.ts", "src/public/client.ts"],
      format: "esm",
      outDir: "dist/exports",
      outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
      platform: "neutral",
      sourcemap: true,
    },
    {
      clean: false,
      dts: { sourcemap: true },
      entry: ["src/public/server.ts"],
      format: "esm",
      outDir: "dist/exports",
      outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
      platform: "node",
      sourcemap: true,
    },
    {
      clean: false,
      dts: { sourcemap: true },
      entry: {
        "internal/server/coordinator/server-child":
          "src/internal/server/coordinator/server-child.ts",
      },
      format: "esm",
      outDir: "dist",
      outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
      platform: "node",
      sourcemap: true,
    },
  ],
});
