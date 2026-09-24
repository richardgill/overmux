---
title: Setting up your UI
---

Your Overmux UI is a React application served and built with Vite. You own its layout, components, and styles; `OvermuxHost` provides the runtime for Overmux’s client APIs.

Run `overmux init` to generate a starter project with the UI setup below.

## File layout

```text
overmux.config.ts
vite.config.ts
src/ui/
  index.html
  main.tsx
  app.tsx
  styles.css
```

## Configure Vite

Set your UI directory as Vite’s root and enable React:

```ts title="vite.config.ts"
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/ui",
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: "../../dist",
  },
});
```

Point your Overmux configuration at this file, keeping your existing server and authentication settings:

```ts title="overmux.config.ts"
import { defineOvermuxConfig } from "overmux";
import server from "./src/server/index";

export default defineOvermuxConfig({
  server,
  auth: { mode: "cli-login" },
  vite: "./vite.config.ts",
  productionWebAssetsDir: "./dist",
});
```

Vite’s output directory is relative to its UI root; `productionWebAssetsDir` points to the same directory from your Overmux configuration.

## The HTML entry point

Provide a root element and load your React entry point:

```html title="src/ui/index.html"
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Overmux</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

## Mount OvermuxHost

Mount your client definition inside `OvermuxHost`. It supplies the runtime required by hooks such as `useCommand` and `useCommands`.

```tsx title="src/ui/main.tsx"
import { OvermuxHost } from "overmux/client";
import { createRoot } from "react-dom/client";

import { client } from "./app";
import "./styles.css";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing root element");
}

createRoot(root).render(<OvermuxHost definition={client} />);
```

## Define your client

Use `defineOvermuxClient` to connect your root React component and command registry:

```tsx title="src/ui/app.tsx"
import { defineOvermuxClient } from "overmux/client";

const App = () => <main>My Overmux UI</main>;

export const client = defineOvermuxClient({
  component: App,
  commands: {},
});
```

`App` is an ordinary React component. Add your own components, state, and layout, or compose components from ecosystem packages.

Start with an empty command registry. See [Commands](./commands) when you want named actions for menus, command palettes, or keyboard shortcuts.

## Add styles

Import your application CSS from `main.tsx`:

```css title="src/ui/styles.css"
body {
  margin: 0;
  font-family: system-ui, sans-serif;
}

main {
  padding: 1rem;
}
```

Individual ecosystem components may require additional stylesheet imports.

## Run your Overmux server

Run your instance through Overmux so the UI has access to its server:

```sh
overmux serve --config ./overmux.config.ts
```

Open the UI URL shown by the server. Vite updates the UI as you edit your React components and styles.
