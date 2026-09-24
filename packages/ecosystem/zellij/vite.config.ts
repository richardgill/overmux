import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      clean: false,
      dts: { sourcemap: true },
      entry: {
        "install/artifact": "src/install/artifact.ts",
        "install/index": "src/install/index.ts",
        "server/index": "src/server/index.ts",
        "shared/index": "src/shared/index.ts",
      },
      format: "esm",
      outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
    },
    {
      clean: false,
      deps: { neverBundle: ["./styles.css"] },
      dts: { sourcemap: true },
      entry: {
        "client/index": "src/client/index.ts",
        "react/index": "src/react/index.ts",
      },
      format: "esm",
      outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
      platform: "browser",
    },
  ],
});
