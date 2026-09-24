import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: { sourcemap: true },
    deps: { neverBundle: ["../styles.css"] },
    entry: {
      "react/index": "src/react/index.ts",
    },
    format: "esm",
    outExtensions: () => ({ dts: ".d.ts", js: ".js" }),
    // The React entry is nested, but the public stylesheet lives at dist's root.
    outputOptions: {
      paths: (id) => (id.endsWith("/styles.css") ? "./styles.css" : id),
    },
    platform: "browser",
    sourcemap: true,
  },
});
