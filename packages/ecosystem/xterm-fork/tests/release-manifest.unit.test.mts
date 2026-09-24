import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublishedManifest } from "../scripts/published-manifest.mts";

test("public manifest explicitly allows runtime metadata and public entry points only", () => {
  const metadata = {
    name: "@overmux/xterm-fork",
    version: "6.0.0-overmux.1",
    description: "Patched xterm.js",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/richardgill/overmux.git",
      directory: "packages/ecosystem/xterm-fork",
    },
    homepage: "https://github.com/richardgill/overmux",
    bugs: { url: "https://github.com/richardgill/overmux/issues" },
  };
  const recipe = {
    ...metadata,
    private: true,
    type: "module",
    scripts: { prepublishOnly: "node scripts/publish-root-guard.mts" },
    devDependencies: { "@changesets/parse": "catalog:" },
    futureToolingSetting: "must not leak",
    main: "dist/lib/xterm.js",
    module: "dist/lib/xterm.mjs",
    types: "dist/typings/xterm.d.ts",
    style: "dist/css/xterm.css",
    exports: { "./tooling": "./scripts/build.mts" },
    files: ["scripts"],
    publishConfig: { directory: "private-recipe" },
  };
  const before = structuredClone(recipe);

  const published = createPublishedManifest(recipe);

  assert.deepEqual(published, {
    ...metadata,
    main: "lib/xterm.js",
    module: "lib/xterm.mjs",
    types: "typings/xterm.d.ts",
    style: "css/xterm.css",
    exports: {
      ".": {
        types: "./typings/xterm.d.ts",
        import: "./lib/xterm.mjs",
        require: "./lib/xterm.js",
      },
      "./css/xterm.css": "./css/xterm.css",
    },
    files: [
      "lib",
      "css",
      "typings",
      "src",
      "docs",
      "LICENSE",
      "README.md",
      "FORK.md",
      "CHANGELOG.md",
    ],
    publishConfig: { access: "public" },
  });
  assert.deepEqual(recipe, before, "workspace metadata must remain unchanged");
});
