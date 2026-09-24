import contentCollections from "@content-collections/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { syncWebsiteDocumentation } from "./scripts/stage-package-docs.ts";
import { watchPackageDocumentation } from "./scripts/watch-package-docs.ts";
import { defineConfig } from "vite";

export default defineConfig(async () => {
  await syncWebsiteDocumentation();

  return {
    plugins: [
      watchPackageDocumentation(),
      contentCollections(),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
    ssr: {
      noExternal: ["fumadocs-ui"],
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        ...(process.env.WWW_APP_ONLY === "true"
          ? {
              "cloudflare:workers": fileURLToPath(
                new URL(
                  "./src/lib/cloudflare-workers-local.ts",
                  import.meta.url,
                ),
              ),
            }
          : {}),
      },
    },
  };
});
