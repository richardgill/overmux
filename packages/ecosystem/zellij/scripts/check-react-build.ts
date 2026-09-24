import { resolve } from "node:path";

import { build } from "vite-plus";

// Bundle the generated React entry without writing output so missing CSS and other unresolved imports fail the package build.
await build({
  configFile: false,
  build: {
    write: false,
    lib: {
      entry: resolve(import.meta.dirname, "../dist/react/index.js"),
      formats: ["es"],
    },
  },
});
