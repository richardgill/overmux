import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      clean: false,
      dts: { sourcemap: true },
      entry: {
        "server/index": "src/server/index.ts",
        "shared/index": "src/shared/index.ts",
      },
      format: "esm",
      outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
    },
    {
      entry: {
        "client/index": "src/client/index.ts",
        "react/index": "src/react/index.ts",
      },
      clean: false,
      dts: { sourcemap: true },
      format: "esm",
      outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
      platform: "browser",
    },
  ],
});
