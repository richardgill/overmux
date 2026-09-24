import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const routeTreePath = fileURLToPath(
  new URL("../src/routeTree.gen.ts", import.meta.url),
);
const run = promisify(execFile);
const before = await readFile(routeTreePath, "utf8");

await run("pnpm", ["exec", "vite", "build"], {
  cwd: root,
  env: { ...process.env, WWW_APP_ONLY: "true" },
});

const after = await readFile(routeTreePath, "utf8");
if (after !== before) {
  throw new Error(
    "src/routeTree.gen.ts is stale. Regenerate it with the WWW Vite build and commit the result.",
  );
}
