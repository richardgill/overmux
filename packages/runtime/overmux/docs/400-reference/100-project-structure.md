---
title: Project Structure
---

Your Overmux application lives in `~/.config/overmux/`. Here is the project structure after running `overmux init`:

```text
~/.config/overmux/
├── overmux.config.ts     # Connects your server and browser UI
├── vite.config.ts        # UI build configuration
├── package.json          # Dependencies and scripts
├── pnpm-lock.yaml        # Locked dependency versions (via pnpm)
├── mise.toml             # Tool versions, when using Mise. Manages pnpm version.
├── AGENTS.md             # Instructions for coding agents
├── CLAUDE.md
├── .gitignore
└── src/
    ├── server/
    │   └── index.ts      # Your Overmux serve side code, runs in Node.js
    └── ui/
        ├── app.tsx       # Your React UI, Shortcuts etc.
        ├── main.tsx      # UI entrypoint
        ├── index.html    # HTML entry point
        └── styles.css
```

See [Storage Locations](./300-storage-locations.md) for directory defaults and overrides.

# Server

Your server definition lives in `src/server/index.ts` and runs in Node.js. Import it into `overmux.config.ts` and pass it as `server`:

```ts title="overmux.config.ts"
import { defineOvermuxConfig } from "overmux";

import server from "./src/server/index"; // import it

export default defineOvermuxConfig({
  server, // pass it to overmux

  auth: { mode: "cli-login" },
  productionWebAssetsDir: "./dist",
  vite: "./vite.config.ts",
});
```

Define your server's capabilities with [Resources](./500-server/100-resources.md), [Operations](./500-server/200-operations.md), and [Streams](./500-server/300-streams.md).

# Client

By default your Overmux client code lives in `src/ui/` and is built using [Vite](https://vite.dev/). Point `vite` in `overmux.config.ts` to your Vite configuration:

```ts title="overmux.config.ts"
import { defineOvermuxConfig } from "overmux";
import server from "./src/server/index";

export default defineOvermuxConfig({
  server,
  auth: { mode: "cli-login" },
  productionWebAssetsDir: "./dist",

  vite: "./vite.config.ts", // vite configuration
});
```

The default `vite.config.ts` sets `src/ui/` as the UI root and builds production assets into `dist/`:

```ts title="vite.config.ts"
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: { emptyOutDir: true, outDir: "../../dist" },
  plugins: [viteReact()],
  root: "src/ui",
});
```

This is a pretty vanilla Vite React application which is yours to configure how you see fit.

See [Client](./600-client/000-index.md) for building your UI, [Client API](./600-client/100-api.md) for available APIs, and [Theming](./600-client/200-theming.md) for styling.


