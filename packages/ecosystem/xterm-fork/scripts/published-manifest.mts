type RecipeMetadata = {
  name: string;
  version: string;
  description: string;
  license: string;
  repository: { type: string; url: string; directory: string };
  homepage: string;
  bugs: { url: string };
};

export const createPublishedManifest = (recipe: RecipeMetadata) => ({
  name: recipe.name,
  version: recipe.version,
  description: recipe.description,
  license: recipe.license,
  repository: {
    type: recipe.repository.type,
    url: recipe.repository.url,
    directory: recipe.repository.directory,
  },
  homepage: recipe.homepage,
  bugs: { url: recipe.bugs.url },
  // Workspace entry points include dist; the public tarball starts at the assembled package root.
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
