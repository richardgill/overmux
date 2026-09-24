import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "content-collections": fileURLToPath(
        new URL("./.content-collections/generated/index.js", import.meta.url),
      ),
      "cloudflare:workers": fileURLToPath(
        new URL("./src/lib/cloudflare-workers-local.ts", import.meta.url),
      ),
    },
  },
});
