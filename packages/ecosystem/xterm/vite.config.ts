// Packages the browser-only xterm React boundary.
// CSS remains external so consumers load its terminal presentation rules.
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: { sourcemap: true },
    deps: { neverBundle: ["./styles.css"] },
    entry: {
      "client/index": "src/client/index.ts",
      keyboard: "src/keyboard.ts",
      react: "src/react.tsx",
      webgl: "src/safe-webgl.ts",
    },
    format: "esm",
    outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
    platform: "browser",
    sourcemap: true,
  },
});
