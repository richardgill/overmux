export type InitToolchain = "mise" | "pnpm";

export const initScaffoldPaths = [
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "mise.toml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "overmux.config.ts",
  "src/server/index.ts",
  "src/ui/app.tsx",
  "src/ui/index.html",
  "src/ui/main.tsx",
  "src/ui/styles.css",
  "vite.config.ts",
] as const;

const packageJson = (overmuxVersion: string) =>
  `${JSON.stringify(
    {
      name: "my-overmux",
      private: true,
      type: "module",
      scripts: {
        build: "vite build",
        check: "overmux check --config ./overmux.config.ts",
        dev: "overmux serve --config ./overmux.config.ts",
      },
      dependencies: {
        overmux: overmuxVersion,
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
      devDependencies: {
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        "@vitejs/plugin-react": "^6.0.0",
        typescript: "^5.9.0",
        vite: "^8.0.0",
      },
    },
    null,
    2,
  )}\n`;

export const createInitScaffold = ({
  overmuxVersion,
  toolchain,
}: {
  overmuxVersion: string;
  toolchain: InitToolchain;
}): Readonly<Record<string, string>> => ({
  ".gitignore": "node_modules\ndist\n",
  "AGENTS.md":
    "Immediately run `overmux docs ai-context` for documentation about Overmux.\n",
  "CLAUDE.md": "@AGENTS.md\n",
  ...(toolchain === "mise"
    ? {
        "mise.toml": `[tools]
node = "22"
pnpm = "10"
"npm:overmux" = "${overmuxVersion}"
`,
      }
    : {}),
  "package.json": packageJson(overmuxVersion),
  "pnpm-workspace.yaml": "onlyBuiltDependencies:\n  - node-pty\n",
  "overmux.config.ts": `import { defineOvermuxConfig } from "overmux";

import server from "./src/server/index";

export default defineOvermuxConfig({
  auth: { mode: "cli-login" },
  productionWebAssetsDir: "./dist",
  server,
  vite: "./vite.config.ts",
});
`,
  "src/server/index.ts": `import { defineOvermuxServer } from "overmux";

export default defineOvermuxServer({ resources: {} });
`,
  "src/ui/app.tsx": `import { defineOvermuxClient } from "overmux/client";

const App = () => <main>Overmux is running.</main>;

export default defineOvermuxClient({
  commands: {},
  component: App,
});
`,
  "src/ui/index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Overmux</title>
  </head>
  <body>
    <div id="root">
      <p>Loading Overmux…</p>
      <button type="button" onclick="location.reload()">Retry</button>
    </div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
`,
  "src/ui/main.tsx": `import { OvermuxHost } from "overmux/client";
import { createRoot } from "react-dom/client";

import definition from "./app";
import "./styles.css";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing root element");
}

createRoot(root).render(<OvermuxHost definition={definition} />);
`,
  "src/ui/styles.css": `:root {
  color: #f5f5f5;
  background: #111;
  font-family: system-ui, sans-serif;
}

body {
  margin: 0;
}

main {
  display: grid;
  min-height: 100vh;
  place-items: center;
}
`,
  "vite.config.ts": `import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: { emptyOutDir: true, outDir: "../../dist" },
  plugins: [viteReact()],
  root: "src/ui",
});
`,
});
