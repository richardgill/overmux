import { defineOvermuxConfig } from "overmux";

import server from "./overmux.server";

export default defineOvermuxConfig({
  auth: { mode: "cli-login" },
  host: "127.0.0.1",
  port: 4210,
  productionWebAssetsDir: "./dist",
  server,
  vite: "./vite.config.ts",
});
