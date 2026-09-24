import { defineOvermuxConfig } from "overmux";

import server from "./overmux.server";

export default defineOvermuxConfig({
  auth: { mode: "cli-login" },
  server,
});
