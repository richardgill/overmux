import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: { sourcemap: true },
    entry: ["src/index.ts"],
    clean: false,
    deps: { neverBundle: ["./styles.css"] },
    format: "esm",
    outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
    platform: "browser",
  },
});
