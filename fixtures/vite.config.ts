import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  build: { outDir: "dist" },
  plugins: [viteReact()],
  root: import.meta.dirname,
});
