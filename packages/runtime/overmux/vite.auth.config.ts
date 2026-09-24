import { dirname, isAbsolute, relative, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

import { bundledDependencyNotices } from "./scripts/bundled-dependency-notices";

const authDirectory = resolve("src/internal/client/auth");
const allowedPackages = /^(?:react|react-dom|zod)(?:\/|$)/;

const isOutsideAuthDirectory = (path: string) => {
  const fromAuthDirectory = relative(authDirectory, path);
  return fromAuthDirectory.startsWith("..") || isAbsolute(fromAuthDirectory);
};

const resolveAuthImport = (source: string, importer?: string) => {
  if (!importer || isOutsideAuthDirectory(importer.split("?", 1)[0]!)) {
    return;
  }
  if (
    allowedPackages.test(source) ||
    source === "vite/modulepreload-polyfill"
  ) {
    return;
  }
  if (!source.startsWith(".")) {
    throw new Error(`The public auth bundle cannot import ${source}`);
  }
  const imported = resolve(dirname(importer), source.split("?", 1)[0]!);
  if (isOutsideAuthDirectory(imported)) {
    throw new Error(`The public auth bundle cannot import ${source}`);
  }
};

const verifyAuthModule = ({ id }: { id: string }) => {
  const path = id.split("?", 1)[0]!;
  if (path.startsWith("\0") || path.includes("node_modules")) {
    return;
  }
  if (isAbsolute(path) && isOutsideAuthDirectory(path)) {
    throw new Error(`The public auth bundle cannot include ${path}`);
  }
};

const authBoundary = (): Plugin => ({
  enforce: "pre",
  moduleParsed: verifyAuthModule,
  name: "overmux-auth-boundary",
  resolveId: resolveAuthImport,
});

export default defineConfig({
  base: "/_overmux/auth-shell/",
  build: {
    emptyOutDir: false,
    manifest: true,
    outDir: resolve("dist/auth"),
  },
  plugins: [authBoundary(), bundledDependencyNotices({ inlineInChunks: true })],
  root: authDirectory,
});
