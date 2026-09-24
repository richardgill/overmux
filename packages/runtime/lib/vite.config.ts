import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: { sourcemap: true },
    entry: ["src/index.ts"],
    format: "esm",
    outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
    platform: "neutral",
  },
});
